// src/pages/P2PPage.tsx
import { useEffect, useState } from "react"
import { useSignal } from "../hooks/useSignal"
import { useP2P } from "../hooks/useP2P"
import CreateJoin from "../components/CreateJoin"
import RoomView from "../components/RoomView"
import type { WSMsg } from "../lib/types"
import { useNavigate } from "react-router-dom"

type PeerState = {
  approved: boolean
  locked: boolean
  sessionId?: string
  wantsToSend?: boolean
}

export default function P2PPage() {
  const signal = useSignal()
  const navigate = useNavigate()
  const ready = Boolean(
    signal.peerId && signal.roomCode && (signal.status === "open" || signal.status === "mock")
  )

  const [peerState, setPeerState] = useState<Record<string, PeerState>>({})

  const p2p = useP2P({
    roomCode: signal.roomCode || "",
    peerId: signal.peerId || "",
    sendWS: signal.send,
  })

  const leaveAndHome = () => {
    signal.leaveRoom()
    navigate("/")
  }

  const currentPeerState = (pid: string): PeerState =>
    peerState[pid] || { approved: false, locked: false }
  const updatePeer = (pid: string, patch: Partial<PeerState>) =>
    setPeerState(prev => ({ ...prev, [pid]: { ...currentPeerState(pid), ...patch } }))

  useEffect(() => {
    if (signal.role !== "sender") return
    const approvedIds = Object.entries(peerState)
      .filter(([, st]) => st.approved)
      .map(([id]) => id)

    for (const id of approvedIds) {
      if (!p2p.peers.get(id)) {
        p2p.connectTo(id).catch(() => { })
      }
    }
  }, [signal.role, peerState, p2p])


  // Bridge WS -> P2P signaling
  useEffect(() => {
    const off = signal.onMessage((m: WSMsg) => p2p.ingestWS(m))
    return off
  }, [signal.onMessage, p2p])

  // Handle room control messages
  useEffect(() => {
    const off = signal.onMessage((m: WSMsg) => {
      // targeted messages
      if ("to" in (m as any) && (m as any).to === signal.peerId) {
        if (m.t === "approve_join") {
          // receiver navigates to waiting
          navigate("/waiting", { state: { roomCode: signal.roomCode, me: signal.peerId } })
          const sender = signal.members.find(mm => mm.role === "sender")
          if (sender) updatePeer(sender.peerId, { approved: true })
          return
        }
        if (m.t === "grant_send") { updatePeer(m.from, { locked: true, sessionId: m.sessionId, wantsToSend: false }); return }
        if (m.t === "deny_send") { updatePeer(m.from, { wantsToSend: false }); alert(m.reason || "Sender denied transfer (busy)."); return }
        if (m.t === "transfer_release") { updatePeer(m.from, { locked: false, sessionId: undefined }); return }
        if (m.t === "request_send") { updatePeer(m.from, { wantsToSend: true }); return }
      }
      // room-level
      if ((m as any).t === "peer_left") {
        setPeerState(prev => {
          const next = { ...prev } as any
          delete next[(m as any).peerId]
          return next
        })
      }
    })
    return off
  }, [signal.peerId, signal.roomCode, navigate, signal.onMessage])

  // Prune state when members change
  useEffect(() => {
    const active = new Set(signal.members.map(m => m.peerId))
    setPeerState(prev => {
      const next: typeof prev = {}
      for (const id of Object.keys(prev)) if (active.has(id)) next[id] = prev[id]
      return next
    })
  }, [signal.members])

  // WaitingPage “Leave Room” bridge
  useEffect(() => {
    const h = () => {
      signal.leaveRoom()
      window.dispatchEvent(new Event("app-leave-ack"))
      navigate("/")
    }
    window.addEventListener("app-leave-room", h as EventListener)
    return () => window.removeEventListener("app-leave-room", h as EventListener)
  }, [signal.leaveRoom, navigate])

  // ❗ Auto-connect to any receiver that just became approved and has no connection yet
  useEffect(() => {
    const approvedIds = Object.entries(peerState)
      .filter(([, st]) => st.approved)
      .map(([id]) => id)

    for (const id of approvedIds) {
      if (!p2p.peers.get(id)) {
        p2p.connectTo(id).catch(() => { })
      }
    }
    // include p2p.peers size so effect re-evaluates when a conn is created
  }, [peerState, p2p])

  // Sender action: approve a receiver (NO hooks inside!)
  function approveReceiver(receiverId: string) {
    signal.send({ t: "approve_join", roomCode: signal.roomCode!, to: receiverId, from: signal.peerId! })
    updatePeer(receiverId, { approved: true })
    // eager attempt; the top-level effect will also ensure we have a conn
    p2p.connectTo(receiverId).catch(() => { })
  }

  function grantSend(receiverId: string) {
    const st = currentPeerState(receiverId); if (st.locked) return
    const sessionId = `S-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    updatePeer(receiverId, { locked: true, sessionId, wantsToSend: false })
    signal.send({ t: "grant_send", roomCode: signal.roomCode!, to: receiverId, from: signal.peerId!, sessionId })
  }
  function denySend(receiverId: string) {
    updatePeer(receiverId, { wantsToSend: false })
    signal.send({ t: "deny_send", roomCode: signal.roomCode!, to: receiverId, from: signal.peerId!, reason: "Busy" })
  }
  function requestToSend(toSenderId: string) {
    const st = currentPeerState(toSenderId); if (st.locked) return
    updatePeer(toSenderId, { wantsToSend: true })
    signal.send({ t: "request_send", roomCode: signal.roomCode!, to: toSenderId, from: signal.peerId! })
  }
  function releaseAfterSend(peerId: string) {
    const st = currentPeerState(peerId)
    if (st.sessionId) {
      signal.send({ t: "transfer_release", roomCode: signal.roomCode!, to: peerId, from: signal.peerId!, sessionId: st.sessionId })
    }
    updatePeer(peerId, { locked: false, sessionId: undefined })
  }

  return (
    <div className="container grid" style={{ gap: 16, marginTop: 24 }}>
      <h1>P2P (Live Transfer)</h1>

      {!ready && <CreateJoin signal={signal} />}

      {ready && (
        <RoomView
          role={signal.role}
          roomCode={signal.roomCode}
          me={signal.peerId}
          members={signal.members}
          peerState={peerState}
          onApprove={approveReceiver}
          onGrantSend={grantSend}
          onDenySend={denySend}
          onRequestSend={requestToSend}
          sendWS={signal.send}
          onWS={signal.onMessage}
          peers={p2p.peers}
          ingestSignal={p2p.ingestWS}
          sendFileTo={async (pid, file) => { await p2p.sendFileTo(pid, file); releaseAfterSend(pid) }}
          sendFileToMany={async (pids, file) => {
            for (const id of pids) await p2p.sendFileTo(id, file)
            for (const id of pids) releaseAfterSend(id)
          }}
          leaveRoom={leaveAndHome}
          connectTo={p2p.connectTo}
        />
      )}
    </div>
  )
}
