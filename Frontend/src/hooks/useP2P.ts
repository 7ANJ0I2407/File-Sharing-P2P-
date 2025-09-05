// src/hooks/useP2P.ts
import { useRef, useState, useEffect } from "react"
import type { WSMsg } from "../lib/types"
import { BUF_LO, BUF_HI, CHUNK_BYTES, frames, readFileChunks } from "../lib/chunker"

// --- TURN/STUN ----------------------------------------------------------------
function normalizeTurnUrls(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(u => (/^(stun|turns?):/i.test(u) ? u : `turn:${u}`))
    // keep only obviously valid-ish entries; drop junk like "turn:rela"
    .filter(u => /^turns?:/.test(u))
}

const turnUrls = normalizeTurnUrls(import.meta.env.VITE_TURN_URL)
const iceServers: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302"] },
  ...(turnUrls.length
    ? [
        {
          urls: turnUrls,
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_CREDENTIAL,
        } as RTCIceServer,
      ]
    : []),
]

// --- Types --------------------------------------------------------------------
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
  answered?: boolean
  gotOffer?: boolean
  remoteAnswered?: boolean
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

// --- Helpers ------------------------------------------------------------------
function waitForOpen(dc: RTCDataChannel, timeoutMs = 15000) {
  return new Promise<void>((resolve, reject) => {
    if (dc.readyState === "open") return resolve()
    const onOpen = () => { cleanup(); resolve() }
    const onCloseOrErr = () => { cleanup(); reject(new Error(`dc state=${dc.readyState}`)) }
    const tid = setTimeout(() => { cleanup(); reject(new Error("dc open timeout")) }, timeoutMs)
    function cleanup() {
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

// --- Hook ---------------------------------------------------------------------
export function useP2P(opts: P2POptions) {
  const { roomCode, peerId: me, sendWS, onLog, onProgress, onReceiveProgress, onComplete } = opts

  // UI copy
  const [peers, setPeers] = useState<Map<string, PeerConn>>(new Map())
  const bump = () => setPeers(prev => new Map(prev))

  const roomRef = useRef(roomCode)
  const meRef = useRef(me)
  useEffect(() => { roomRef.current = roomCode }, [roomCode])
  useEffect(() => { meRef.current = me }, [me])

  // authoritative
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

  // --- Sender: connect + datachannel -----------------------------------------
  async function connectTo(peerId: string) {
    const existing = getPeer(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: (import.meta.env.VITE_FORCE_TURN === "1" ? "relay" : "all"),
      iceCandidatePoolSize: 1,
      bundlePolicy: "max-bundle",
    })

    pc.oniceconnectionstatechange = () => log?.(`[p2p] ice=${pc.iceConnectionState}`)
    pc.onconnectionstatechange = () => log?.(`[p2p] pc=${pc.connectionState}`)

    pc.onicecandidate = (e) => {
      if (e.candidate || e.candidate === null) {
        // useful while debugging: console.log("[ICE]", e.candidate?.candidate)
        sendWS({
          t: "ice",
          roomCode: roomRef.current,
          to: peerId,
          from: meRef.current,
          candidate: e.candidate ?? null,
        } as any)
      }
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        sendWS({ t: "ice", roomCode: roomRef.current, to: peerId, from: meRef.current, candidate: null } as any)
      }
    }

    const dc = pc.createDataChannel(`file-${peerId}`, { ordered: true })
    const conn: PeerConn = { peerId, pc, dc, queue: [], sentBytes: 0, receivedBytes: 0 }

    dc.binaryType = "arraybuffer"
    dc.bufferedAmountLowThreshold = BUF_LO
    dc.onopen = () => { log?.(`[p2p] dc OPEN -> ${peerId}`); bump() }
    dc.onclose = () => { log?.(`[p2p] dc CLOSED -> ${peerId}`); bump() }
    dc.onmessage = () => { /* sender ignores ack */ }
    dc.onbufferedamountlow = () => {
      while (conn.queue.length && dc.bufferedAmount < BUF_HI) dc.send(conn.queue.shift()!)
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendWS({ t: "offer", roomCode: roomRef.current, to: peerId, from: meRef.current, sdp: offer.sdp! })

    setPeer(peerId, conn)
    return conn
  }

  // --- Signaling --------------------------------------------------------------
  async function handleSignal(msg: WSMsg) {
    // ANSWER (sender side)
    if (msg.t === "answer" && msg.to === meRef.current) {
      const conn = getPeer(msg.from); if (!conn) return
      const st = conn.pc.signalingState
      if (conn.remoteAnswered || st !== "have-local-offer") {
        log?.(`[p2p] ignore answer from ${msg.from} in state=${st}`)
        return
      }
      try {
        await conn.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp })
        conn.remoteAnswered = true
        const pending = pendingIceRef.current.get(msg.from)
        if (pending) {
          for (const cand of pending) { try { await conn.pc.addIceCandidate(cand) } catch {} }
          pendingIceRef.current.delete(msg.from)
        }
        log?.(`[p2p] applied answer from ${msg.from}`)
      } catch (e) {
        log?.(`[p2p] failed to apply answer: ${(e as Error).message}`)
      }
      return
    }

    // ICE (both directions)
    if (msg.t === "ice" && msg.to === meRef.current) {
      const conn = getPeer(msg.from)
      if (conn) {
        if (msg.candidate === null) { try { await conn.pc.addIceCandidate(null) } catch {}; return }
        try { await conn.pc.addIceCandidate(msg.candidate) }
        catch {
          const list = pendingIceRef.current.get(msg.from) || []
          list.push(msg.candidate)
          pendingIceRef.current.set(msg.from, list)
        }
      } else {
        const list = pendingIceRef.current.get(msg.from) || []
        list.push(msg.candidate) // may be null
        pendingIceRef.current.set(msg.from, list)
      }
      return
    }

    // OFFER (receiver side)
    if (msg.t === "offer" && msg.to === meRef.current) {
      const from = msg.from
      let conn = getPeer(from)
      if (!conn) {
        const pc = new RTCPeerConnection({
          iceServers,
          iceTransportPolicy: (import.meta.env.VITE_FORCE_TURN === "1" ? "relay" : "all"),
          iceCandidatePoolSize: 1,
          bundlePolicy: "max-bundle",
        })

        pc.oniceconnectionstatechange = () => log?.(`[p2p] ice<= ${pc.iceConnectionState}`)
        pc.onconnectionstatechange = () => log?.(`[p2p] pc<= ${pc.connectionState}`)

        pc.onicecandidate = (e) => {
          if (e.candidate || e.candidate === null) {
            sendWS({
              t: "ice",
              roomCode: roomRef.current,
              to: from,
              from: meRef.current,
              candidate: e.candidate ?? null,
            } as any)
          }
        }
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            sendWS({ t: "ice", roomCode: roomRef.current, to: from, from: meRef.current, candidate: null } as any)
          }
        }

        // Receiver: datachannel arrives from sender
        pc.ondatachannel = (e) => {
          const dc = e.channel
          conn!.dc = dc
          dc.binaryType = "arraybuffer"
          dc.bufferedAmountLowThreshold = BUF_LO
          dc.onopen = () => { log?.(`dc open <- ${from}`); bump() }
          dc.onclose = () => { log?.(`dc closed <- ${from}`); bump() }

          const parts: ArrayBuffer[] = []

          dc.onmessage = (ev) => {
            // 1) control/meta/complete/ack
            if (typeof ev.data === "string") {
              const meta = JSON.parse(ev.data)
              if (meta.t === "meta") {
                conn!.transferId = meta.transferId
                conn!.fileName = meta.name
                conn!.fileSize = meta.size
                conn!.fileMime = meta.mime
                conn!.receivedBytes = 0
                try {
                  window.dispatchEvent(new CustomEvent("p2p-progress", {
                    detail: { received: 0, total: meta.size, name: meta.name }
                  }))
                } catch {}
                return
              }
              if (meta.t === "ack_req") {
                dc!.send(JSON.stringify({ t: "ack", transferId: conn!.transferId, offset: conn!.receivedBytes }))
                return
              }
              if (meta.t === "complete") {
                if (conn!.done) return
                conn!.done = true
                const blob = new Blob(parts, { type: conn!.fileMime || "application/octet-stream" })
                try {
                  window.dispatchEvent(new CustomEvent("p2p-complete", {
                    detail: { blob, name: conn!.fileName || "received" }
                  }))
                } catch {}
                onComplete?.(conn!.peerId, blob)
                return
              }
              return
            }

            // 2) binary payloads: ArrayBuffer | Blob | TypedArray
            ;(async () => {
              let ab: ArrayBuffer | null = null
              if (ev.data instanceof ArrayBuffer) {
                ab = ev.data as ArrayBuffer
              } else if (typeof Blob !== "undefined" && ev.data instanceof Blob) {
                ab = await (ev.data as Blob).arrayBuffer()
              } else if (ArrayBuffer.isView(ev.data)) {
                const v = ev.data as ArrayBufferView
                ab = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)
              }
              if (!ab) {
                log?.("[p2p] unknown binary payload type; dropping")
                return
              }
              parts.push(ab)
              conn!.receivedBytes += ab.byteLength
              onReceiveProgress?.(conn!.peerId, conn!.receivedBytes, conn!.fileSize)
              try {
                window.dispatchEvent(new CustomEvent("p2p-progress", {
                  detail: { received: conn!.receivedBytes, total: conn!.fileSize, name: conn!.fileName }
                }))
              } catch {}
            })().catch(() => {})
          }
        }

        conn = { peerId: from, pc, dc: null as any, queue: [], sentBytes: 0, receivedBytes: 0, answered: false }
        setPeer(from, conn)
      }

      const pc = conn.pc

      if (pc.signalingState !== "stable") {
        try { await pc.setLocalDescription({ type: "rollback" } as any); log?.("[p2p] rollback for new offer") } catch {}
      }

      try {
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        conn.answered = true
        sendWS({ t: "answer", roomCode: roomRef.current, to: from, from: meRef.current, sdp: answer.sdp! })

        const pending = pendingIceRef.current.get(from)
        if (pending) {
          for (const cand of pending) { try { await pc.addIceCandidate(cand) } catch {} }
          pendingIceRef.current.delete(from)
        }
        log?.("[p2p] answer sent")
      } catch (e) {
        log?.(`[p2p] failed to answer: ${(e as Error).message}`)
      }
      return
    }
  }

  // --- Sending ---------------------------------------------------------------
  async function sendFileTo(peerId: string, file: File) {
    let conn = peersRef.current.get(peerId) || await connectTo(peerId)

    try { await waitForOpen(conn.dc) }
    catch (e) {
      log?.(`[p2p] reopen ${peerId} because: ${(e as Error).message}`)
      try { conn.pc.close() } catch {}
      peersRef.current.delete(peerId)
      setPeers(new Map(peersRef.current))
      conn = await connectTo(peerId)
      await waitForOpen(conn.dc)
    }

    const { dc } = conn
    const transferId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    conn.sentBytes = 0
    conn.queue.length = 0
    dc.send(JSON.stringify({ t: "meta", transferId, name: file.name, size: file.size, mime: file.type, chunkBytes: CHUNK_BYTES }))
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
    for (const id of peerIds) {
      let c = peersRef.current.get(id) || await connectTo(id)
      if (c.dc.readyState !== "open") {
        try { await waitForOpen(c.dc) }
        catch {
          try { c.pc.close() } catch {}
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

  // --- External API -----------------------------------------------------------
  function ingestWS(msg: WSMsg) { handleSignal(msg) }

  function removePeer(peerId: string) {
    const next = new Map(peersRef.current)
    const c = next.get(peerId)
    try { c?.dc.close() } catch {}
    try { c?.pc.close() } catch {}
    next.delete(peerId)
    peersRef.current = next
    setPeers(next)
  }

  return { peers, connectTo, sendFileTo, sendFileToMany, ingestWS, removePeer }
}
