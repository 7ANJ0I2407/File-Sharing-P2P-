// src/hooks/useP2P.ts
import { useRef, useState } from "react"
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

export function useP2P(opts: P2POptions) {
  const { roomCode, peerId: me, sendWS, onLog, onProgress, onReceiveProgress, onComplete } = opts

  // UI copy (for rendering)
  const [peers, setPeers] = useState<Map<string, PeerConn>>(new Map())
  // authoritative live map (prevents stale closure in handleSignal)
  const peersRef = useRef<Map<string, PeerConn>>(new Map())
  // buffer ICE that arrives before a conn is created
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
    dc.onopen = () => log(`dc open -> ${peerId}`)
    dc.onclose = () => log(`dc closed -> ${peerId}`)
    dc.onmessage = () => {} // ACKs ignored on sender
    dc.onbufferedamountlow = () => {
      while (conn.queue.length && dc.bufferedAmount < BUF_HI) dc.send(conn.queue.shift()!)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) sendWS({ t: "ice", roomCode, to: peerId, from: me, candidate: e.candidate })
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendWS({ t: "offer", roomCode, to: peerId, from: me, sdp: offer.sdp! })

    setPeer(peerId, conn)
    return conn
  }

  // ---------- COMMON: signaling ----------
  async function handleSignal(msg: WSMsg) {
    // Sender path: answer to my offer
    if (msg.t === "answer" && msg.to === me) {
      const conn = getPeer(msg.from)
      if (conn) await conn.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp })
      return
    }

    // ICE (both directions) — if no conn yet, buffer it
    if (msg.t === "ice" && msg.to === me) {
      const conn = getPeer(msg.from)
      if (conn) {
        await conn.pc.addIceCandidate(msg.candidate)
      } else {
        const list = pendingIceRef.current.get(msg.from) || []
        list.push(msg.candidate)
        pendingIceRef.current.set(msg.from, list)
      }
      return
    }

    // Receiver path: got an offer
    if (msg.t === "offer" && msg.to === me) {
      const from = msg.from
      const pc = new RTCPeerConnection({ iceServers })
      const parts: ArrayBuffer[] = []
      const conn: PeerConn = { peerId: from, pc, dc: null as any, queue: [], sentBytes: 0, receivedBytes: 0 }

      pc.ondatachannel = (e) => {
        const dc = e.channel
        conn.dc = dc
        dc.binaryType = "arraybuffer"
        dc.bufferedAmountLowThreshold = BUF_LO
        dc.onopen = () => log(`dc open <- ${from}`)

        dc.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            const meta = JSON.parse(ev.data)
            if (meta.t === "meta") {
              conn.transferId = meta.transferId
              conn.fileName = meta.name
              conn.fileSize = meta.size
              conn.fileMime = meta.mime
              // notify WaitingPage immediately
              try {
                window.dispatchEvent(new CustomEvent("p2p-progress", {
                  detail: { received: 0, total: meta.size, name: meta.name }
                }))
              } catch {}
            } else if (meta.t === "ack_req") {
              dc!.send(JSON.stringify({ t: "ack", transferId: conn.transferId, offset: conn.receivedBytes }))
            } else if (meta.t === "complete") {
              const blob = new Blob(parts, { type: conn.fileMime || "application/octet-stream" })
              onComplete?.(conn.peerId, blob)
            }
          } else if (ev.data instanceof ArrayBuffer) {
            parts.push(ev.data)
            conn.receivedBytes += ev.data.byteLength
            onReceiveProgress?.(conn.peerId, conn.receivedBytes, conn.fileSize)
          }
        }
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) sendWS({ t: "ice", roomCode, to: from, from: me, candidate: e.candidate })
      }

      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log("[p2p] sending answer to", from)
      sendWS({ t: "answer", roomCode, to: from, from: me, sdp: answer.sdp! })

      // store conn immediately (so subsequent ICE finds it)
      setPeer(from, conn)

      // drain buffered ICE
      const pending = pendingIceRef.current.get(from)
      if (pending && pending.length) {
        for (const cand of pending) { try { await pc.addIceCandidate(cand) } catch {} }
        pendingIceRef.current.delete(from)
      }
    }
  }

  // ---------- SENDING ----------
  async function sendFileTo(peerId: string, file: File) {
    const conn = getPeer(peerId) || await connectTo(peerId)
    const { dc } = conn
    const transferId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    dc.send(JSON.stringify({ t: "meta", transferId, name: file.name, size: file.size, mime: file.type, chunkBytes: CHUNK_BYTES }))
    conn.transferId = transferId
    for await (const { buf } of readFileChunks(file)) {
      for (const f of frames(buf)) {
        if (dc.bufferedAmount > BUF_HI) {
          await new Promise(res => {
            const h = () => { dc.removeEventListener("bufferedamountlow", h); res(null) }
            dc.addEventListener("bufferedamountlow", h, { once: true })
          })
        }
        dc.send(f)
        conn.sentBytes += (f as ArrayBuffer).byteLength
        opts.onProgress?.(peerId, conn.sentBytes, file.size)
      }
      dc.send(JSON.stringify({ t: "ack_req", transferId, offset: conn.sentBytes }))
    }
    dc.send(JSON.stringify({ t: "complete", transferId }))
  }

  async function sendFileToMany(peerIds: string[], file: File) {
    for (const id of peerIds) await connectTo(id)
    const conns = peerIds.map(id => getPeer(id)!).filter(Boolean)
    const transferId = `T-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    for (const c of conns) {
      c.transferId = transferId
      c.dc.send(JSON.stringify({ t: "meta", transferId, name: file.name, size: file.size, mime: file.type, chunkBytes: CHUNK_BYTES }))
    }
    for await (const { buf } of readFileChunks(file)) {
      const fs = Array.from(frames(buf))
      for (const c of conns) {
        for (const f of fs) {
          if (c.dc.bufferedAmount < BUF_HI) c.dc.send(f)
          else c.queue.push(f)
          c.dc.onbufferedamountlow = () => {
            while (c.queue.length && c.dc.bufferedAmount < BUF_HI) c.dc.send(c.queue.shift()!)
          }
          c.sentBytes += (f as ArrayBuffer).byteLength
          opts.onProgress?.(c.peerId, c.sentBytes, file.size)
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
