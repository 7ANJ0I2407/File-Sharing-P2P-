// src/hooks/useP2P.ts
import { useRef, useState, useEffect } from "react"
import type { WSMsg } from "../lib/types"
import { BUF_LO, BUF_HI, CHUNK_BYTES, frames, readFileChunks } from "../lib/chunker"

const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }]

export type PeerConn = {
  peerId: string
  pc: RTCPeerConnection
  dc: RTCDataChannel
  queue: ArrayBuffer[]
  sentBytes: number
  receivedBytes: number
  fileName?: string
  fileSize?: number
  fileMime?: string
  transferId?: string
  done?: boolean
}

type P2POptions = {
  roomCode: string
  peerId: string
  sendWS: (m: WSMsg) => void
  onLog?: (s: string) => void
  onProgress?: (peerId: string, sent: number, total?: number) => void
  onReceiveProgress?: (peerId: string, recv: number, total?: number) => void
  onComplete?: (peerId: string, blob: Blob) => void
}

// Wait until a DataChannel opens (resolves) or errors/closes (rejects)
function waitForOpen(dc: RTCDataChannel, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    if (dc.readyState === "open") return resolve()
    const onOpen = () => { cleanup(); resolve() }
    const onCloseOrErr = () => { cleanup(); reject(new Error(`dc state=${dc.readyState}`)) }
    const tid = setTimeout(() => { cleanup(); reject(new Error("dc open timeout")) }, timeoutMs)
    const cleanup = () => {
      clearTimeout(tid)
      dc.removeEventListener("open", onOpen)
      dc.removeEventListener("close", onCloseOrErr)
      dc.removeEventListener("error", onCloseOrErr)
    }
    dc.addEventListener("open", onOpen, { once: true })
    dc.addEventListener("close", onCloseOrErr, { once: true })
    dc.addEventListener("error", onCloseOrErr, { once: true })
  })
}

export function useP2P(opts: P2POptions) {
  const { roomCode, peerId: me, sendWS, onLog, onProgress, onReceiveProgress, onComplete } = opts

  // UI copy (for rendering)
  const [peers, setPeers] = useState<Map<string, PeerConn>>(new Map())
  const bump = () => setPeers(prev => new Map(prev))
  const roomRef = useRef(roomCode);
  const meRef = useRef(me);
  useEffect(() => { roomRef.current = roomCode }, [roomCode]);
  useEffect(() => { meRef.current = me }, [me]);

  // authoritative map / pending ICE
  const peersRef = useRef<Map<string, PeerConn>>(new Map())
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())

  const log = (s: string) => onLog?.(s)

  function setPeer(id: string, conn: PeerConn) {
    const next = new Map(peersRef.current)
    next.set(id, conn)
    peersRef.current = next
    setPeers(next)
  }
  const getPeer = (id: string) => peersRef.current.get(id)

  // ---------- SENDER: create conn + datachannel ----------
  async function connectTo(peerId: string) {
    const existing = getPeer(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers })
    const dc = pc.createDataChannel(`file-${peerId}`, { ordered: true })
    const conn: PeerConn = { peerId, pc, dc, queue: [], sentBytes: 0, receivedBytes: 0 }

    dc.binaryType = "arraybuffer"
    dc.bufferedAmountLowThreshold = BUF_LO
    dc.onopen = () => { log?.(`[p2p] dc OPEN -> ${peerId}`); bump() }
    dc.onclose = () => { log?.(`[p2p] dc CLOSED -> ${peerId}`); bump() }
    dc.onmessage = () => { /* sender ignores small ACKs */ }
    dc.onbufferedamountlow = () => {
      while (conn.queue.length && dc.bufferedAmount < BUF_HI) dc.send(conn.queue.shift()!)
    }

    pc.onconnectionstatechange = () => { log?.(`[p2p] pc=${pc.connectionState}`); bump() }
    pc.onicecandidate = (e) => {
      if (e.candidate) sendWS({ t: "ice", roomCode: roomRef.current, to: peerId, from: meRef.current, candidate: e.candidate })
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendWS({ t: "offer", roomCode: roomRef.current, to: peerId, from: meRef.current, sdp: offer.sdp! })

    setPeer(peerId, conn)
    return conn
  }

  // ---------- COMMON: signaling ----------
  async function handleSignal(msg: WSMsg) {
    // Sender path: answer to my offer
    if (msg.t === "answer" && msg.to === meRef.current) {
      const conn = getPeer(msg.from)
      if (!conn) return
      const st = conn.pc.signalingState
      // Only a valid time to apply a remote *answer* is when we have a local offer.
      if (st !== "have-local-offer") {
        log?.(`[p2p] ignore duplicate/late answer in state=${st} from ${msg.from}`)
        return
      }
      await conn.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp })
      return
    }

    // ICE (both directions)
    if (msg.t === "ice" && msg.to === meRef.current) {
      const conn = getPeer(msg.from)
      if (conn) {
        try { await conn.pc.addIceCandidate(msg.candidate) } catch { /* ignore bad trickle */ }
      } else {
        const list = pendingIceRef.current.get(msg.from) || []
        list.push(msg.candidate)
        pendingIceRef.current.set(msg.from, list)
      }
      return
    }

    // Receiver path: got an offer
    if (msg.t === "offer" && msg.to === meRef.current) {
      if (!roomRef.current && msg.roomCode) roomRef.current = msg.roomCode;
      log?.(`[p2p] got offer from ${msg.from} -> sending answer`)
      // const from = msg.from
      // const pc = new RTCPeerConnection({ iceServers })
      // const parts: ArrayBuffer[] = []
      // const conn: PeerConn = { peerId: from, pc, dc: null as any, queue: [], sentBytes: 0, receivedBytes: 0 }
      const from = msg.from
      let conn = getPeer(from)
      let pc: RTCPeerConnection
      if (!conn) {
        pc = new RTCPeerConnection({ iceServers })
        conn = { peerId: from, pc, dc: null as any, queue: [], sentBytes: 0, receivedBytes: 0 }
        setPeer(from, conn) // store early so ICE can find it
      } else {
        pc = conn.pc
      }
      const parts: ArrayBuffer[] = []

      pc.ondatachannel = (e) => {
        const dc = e.channel
        conn.dc = dc
        dc.binaryType = "arraybuffer"
        dc.bufferedAmountLowThreshold = BUF_LO
        dc.onopen = () => { log?.(`dc open <- ${from}`); bump() }
        dc.onclose = () => { log?.(`dc closed <- ${from}`); bump() }

        dc.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            const meta = JSON.parse(ev.data)
            if (meta.t === "meta") {
              conn.transferId = meta.transferId
              conn.fileName = meta.name
              conn.fileSize = meta.size
              conn.fileMime = meta.mime
              parts.length = 0
              conn.receivedBytes = 0
              // fire initial 0% progress so UI flips from "waiting"
              try {
                window.dispatchEvent(new CustomEvent("p2p-progress", {
                  detail: { received: 0, total: meta.size, name: meta.name }
                }))
              } catch { }
            } else if (meta.t === "ack_req") {
              if (meta.transferId === conn.transferId) {
                dc!.send(JSON.stringify({ t: "ack", transferId: conn.transferId, offset: conn.receivedBytes }))
              }
            } else if (meta.t === "complete") {
              const blob = new Blob(parts, { type: conn.fileMime || "application/octet-stream" })
              parts.length = 0
              conn.receivedBytes = 0
              // global event for WaitingPage + optional callback
              try {
                window.dispatchEvent(new CustomEvent("p2p-complete", {
                  detail: { blob, name: conn.fileName || "received" }
                }))
              } catch { }
              onComplete?.(conn.peerId, blob)
            }
          } else if (ev.data instanceof ArrayBuffer) {
            parts.push(ev.data)
            conn.receivedBytes += ev.data.byteLength
            // callback + global event so WaitingPage progress is instant
            onReceiveProgress?.(conn.peerId, conn.receivedBytes, conn.fileSize)
            try {
              window.dispatchEvent(new CustomEvent("p2p-progress", {
                detail: { received: conn.receivedBytes, total: conn.fileSize, name: conn.fileName }
              }))
            } catch { }
          }
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) sendWS({ t: "ice", roomCode: roomRef.current || msg.roomCode, to: from, from: meRef.current, candidate: e.candidate })
      }
      if (pc.signalingState === "have-local-offer") {
        try { await pc.setLocalDescription({ type: "rollback" } as any) } catch { }
      }

      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      log?.("[p2p] sending answer to " + from)
      sendWS({ t: "answer", roomCode: roomRef.current || msg.roomCode, to: from, from: meRef.current, sdp: answer.sdp! })

      // store conn immediately (so subsequent ICE finds it)
      // setPeer(from, conn)

      // drain buffered ICE if any
      const pending = pendingIceRef.current.get(from)
      if (pending && pending.length) {
        for (const cand of pending) { try { await pc.addIceCandidate(cand) } catch { } }
        pendingIceRef.current.delete(from)
      }
      log?.("[p2p] answer sent")
    }
  }

  // ---------- SENDING ----------
  async function sendFileTo(peerId: string, file: File) {
    let conn = peersRef.current.get(peerId) || await connectTo(peerId)

    // wait until the DC is actually open
    try { await waitForOpen(conn.dc) }
    catch (e) {
      log?.(`[p2p] reopen ${peerId} because: ${(e as Error).message}`)
      try { conn.pc.close() } catch { }
      peersRef.current.delete(peerId)
      setPeers(new Map(peersRef.current))
      conn = await connectTo(peerId)
      await waitForOpen(conn.dc) // throw if still not open
    }

    const { dc } = conn
    const transferId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    conn.sentBytes = 0
    conn.queue.length = 0
    dc.send(JSON.stringify({
      t: "meta", transferId, name: file.name, size: file.size, mime: file.type, chunkBytes: CHUNK_BYTES
    }))
    conn.transferId = transferId

    for await (const { buf } of readFileChunks(file)) {
      for (const f of frames(buf)) {
        if (dc.readyState !== "open") throw new Error(`DataChannel became ${dc.readyState}`)
        if (dc.bufferedAmount > BUF_HI) {
          await new Promise(res => {
            const h = () => { dc.removeEventListener("bufferedamountlow", h); res(null) }
            dc.addEventListener("bufferedamountlow", h, { once: true })
          })
        }
        dc.send(f)
        conn.sentBytes += (f as ArrayBuffer).byteLength
        onProgress?.(peerId, conn.sentBytes, file.size)
      }
      dc.send(JSON.stringify({ t: "ack_req", transferId, offset: conn.sentBytes }))
    }
    dc.send(JSON.stringify({ t: "complete", transferId }))
  }

  async function sendFileToMany(peerIds: string[], file: File) {
    // ensure all DCs are open
    for (const id of peerIds) {
      let c = peersRef.current.get(id) || await connectTo(id)
      if (c.dc.readyState !== "open") {
        try { await waitForOpen(c.dc) }
        catch {
          try { c.pc.close() } catch { }
          peersRef.current.delete(id)
          setPeers(new Map(peersRef.current))
          c = await connectTo(id)
          await waitForOpen(c.dc)
        }
      }
    }

    const conns = peerIds.map(id => peersRef.current.get(id)!).filter(Boolean)
    const transferId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    for (const c of conns) {
      c.sentBytes = 0
      c.queue.length = 0
      c.transferId = transferId
      c.dc.send(JSON.stringify({ t: "meta", transferId, name: file.name, size: file.size, mime: file.type, chunkBytes: CHUNK_BYTES }))
    }

    for await (const { buf } of readFileChunks(file)) {
      const fs = Array.from(frames(buf))
      for (const c of conns) {
        for (const f of fs) {
          if (c.dc.readyState !== "open") throw new Error(`dc to ${c.peerId} closed`)
          if (c.dc.bufferedAmount < BUF_HI) c.dc.send(f)
          else c.queue.push(f)
          c.dc.onbufferedamountlow = () => {
            while (c.queue.length && c.dc.bufferedAmount < BUF_HI) c.dc.send(c.queue.shift()!)
          }
          c.sentBytes += (f as ArrayBuffer).byteLength
          onProgress?.(c.peerId, c.sentBytes, file.size)
        }
        c.dc.send(JSON.stringify({ t: "ack_req", transferId, offset: c.sentBytes }))
      }
    }

    for (const c of conns) c.dc.send(JSON.stringify({ t: "complete", transferId }))
  }

  // external
  function ingestWS(msg: WSMsg) { handleSignal(msg) }
  function removePeer(peerId: string) {
    const next = new Map(peersRef.current)
    const c = next.get(peerId)
    c?.dc.close(); c?.pc.close()
    next.delete(peerId)
    peersRef.current = next
    setPeers(next)
  }

  return { peers, connectTo, sendFileTo, sendFileToMany, ingestWS, removePeer }
}
