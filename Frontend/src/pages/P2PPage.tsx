import React, { useEffect, useState } from "react"
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

  // unified leave handler (used by both sender & receiver UIs)
  const leaveAndHome = () => {
    signal.leaveRoom()
    navigate("/")
  }

  const currentPeerState = (pid: string): PeerState =>
    peerState[pid] || { approved: false, locked: false }
  const updatePeer = (pid: string, patch: Partial<PeerState>) =>
    setPeerState(prev => ({ ...prev, [pid]: { ...currentPeerState(pid), ...patch } }))

  useEffect(() => {
    const off = signal.onMessage((m: WSMsg) => {
      // targetted messages
      // @ts-expect-error runtime narrowing
      if ("to" in m && (m as any).to === signal.peerId) {
        if (m.t === "approve_join") {
          navigate("/waiting", { state: { roomCode: signal.roomCode, me: signal.peerId } })
          const sender = signal.members.find(mm => mm.role === "sender")
          if (sender) updatePeer(sender.peerId, { approved: true })
          return
        }
        if (m.t === "grant_send") { updatePeer(m.from, { locked: true, sessionId: m.sessionId, wantsToSend: false }); return }
        if (m.t === "deny_send")  { updatePeer(m.from, { wantsToSend: false }); alert(m.reason || "Sender denied transfer (busy)."); return }
        if (m.t === "transfer_release") { updatePeer(m.from, { locked: false, sessionId: undefined }); return }
        if (m.t === "request_send")    { updatePeer(m.from, { wantsToSend: true }); return }
      }
      // room-level
      if ((m as any).t === "peer_left") {
        setPeerState(prev => { const next = { ...prev } as any; delete next[(m as any).peerId]; return next })
      }
    })
    return off
  }, [signal.peerId, signal.roomCode, navigate, signal.onMessage])

  // prune on members change
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
    window.dispatchEvent(new Event("app-leave-ack")) // ✅ tell WaitingPage we handled it
    // then navigate home
    navigate("/")  // if you keep P2PPage mounted while waiting, you can navigate too
  }
  window.addEventListener("app-leave-room", h as EventListener)
  return () => window.removeEventListener("app-leave-room", h as EventListener)
}, [signal.leaveRoom, navigate])

// useEffect(() => {
//   const onClosed = () => {
//     signal.leaveRoom()
//     // tell WaitingPage we handled it (if it’s open in another route)
//     window.dispatchEvent(new Event("app-leave-ack"))
//     navigate("/")
//   }
//   window.addEventListener("room-closed", onClosed as EventListener)
//   return () => window.removeEventListener("room-closed", onClosed as EventListener)
// }, [signal.leaveRoom, navigate])


  // sender actions
  function approveReceiver(receiverId: string) {
    signal.send({ t: "approve_join", roomCode: signal.roomCode!, to: receiverId, from: signal.peerId! })
    updatePeer(receiverId, { approved: true })
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

  // receiver action
  function requestToSend(toSenderId: string) {
    const st = currentPeerState(toSenderId); if (st.locked) return
    updatePeer(toSenderId, { wantsToSend: true })
    signal.send({ t: "request_send", roomCode: signal.roomCode!, to: toSenderId, from: signal.peerId! })
  }
    useEffect(() => {
    // don’t attach until we know who we are (prevents early noise)
    if (!signal.peerId) return;
    const off = signal.onMessage((m: WSMsg) => {
      p2p.ingestWS(m);   // <— the important part
    });
    return off;
  }, [signal.peerId, signal.roomCode, p2p]);

  // release after I finish sending
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
          leaveRoom={leaveAndHome}   // <- both sender & receiver can leave
        />
      )}
    </div>
  )
}
