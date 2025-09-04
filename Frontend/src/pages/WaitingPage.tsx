// src/pages/WaitingPage.tsx
import React, { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import ProgressBar from "../components/ProgressBar"
import { useSignal } from "../hooks/useSignal"
import { useP2P } from "../hooks/useP2P"
import type { WSMsg } from "../lib/types"

type LocState = { roomCode: string; me: string }

export default function WaitingPage() {
  const location = useLocation() as { state?: LocState }
  const fallbackRoom = location.state?.roomCode || ""
  const fallbackMe = location.state?.me || ""

  // ---- signaling (WS) ----
  const signal = useSignal()
  // take ids from live signal if present; else fall back to nav state
  const roomCode = signal.roomCode || fallbackRoom
  const me = signal.peerId || fallbackMe

  // ---- local receive UI state ----
  const [name, setName] = useState<string | undefined>(undefined)
  const [received, setReceived] = useState(0)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [done, setDone] = useState(false)

  // ---- spin a local P2P endpoint (receiver side) ----
  const p2p = useP2P({
    roomCode,
    peerId: me,
    sendWS: signal.send,
    onReceiveProgress: (_peerId, recv, tot) => {
      setReceived(recv)
      if (tot !== undefined) setTotal(tot)
      window.dispatchEvent(new CustomEvent("p2p-progress", {
        detail: {
          received: recv, total: tot, name
        }
      }))
    },
    onComplete: (_peerId, blob) => {
      window.dispatchEvent(new CustomEvent("p2p-complete", {
        detail: { blob, name }
      }))
    }
  })

  // ---- bridge WS -> WebRTC while we're on /waiting ----
  useEffect(() => {
    // Subscribe ASAP so early 'offer' isn't missed; handleSignal uses refs for ids.
    const off = signal.onMessage((m: WSMsg) => p2p.ingestWS(m))
    return off
  }, [signal, p2p])

  // ---- UI: progress + auto download ----
  useEffect(() => {
    const onProg = (e: any) => {
      const d = e.detail as { received: number; total?: number; name?: string }
      if (d.name) setName(d.name)
      setReceived(d.received ?? 0)
      setTotal(d.total)
    }
    const onDone = (e: any) => {
      const d = e.detail as { blob: Blob; name?: string }
      setDone(true)
      const a = document.createElement("a")
      a.href = URL.createObjectURL(d.blob)
      a.download = d.name || name || "received"
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }
    window.addEventListener("p2p-progress", onProg as EventListener)
    window.addEventListener("p2p-complete", onDone as EventListener)
    return () => {
      window.removeEventListener("p2p-progress", onProg as EventListener)
      window.removeEventListener("p2p-complete", onDone as EventListener)
    }
  }, [name])

  const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0

  // ---- if sender leaves -> room_closed -> force leave ----
  useEffect(() => {
    const onClosed = () => softLeaveOrHardRedirect()
    window.addEventListener("room-closed", onClosed as EventListener)
    return () => window.removeEventListener("room-closed", onClosed as EventListener)
  }, [])

  function softLeaveOrHardRedirect() {
    let handled = false
    const ack = () => { handled = true }
    window.addEventListener("app-leave-ack", ack as EventListener, { once: true })
    window.dispatchEvent(new CustomEvent("app-leave-room"))
    setTimeout(() => { if (!handled) window.location.href = "/" }, 50)
  }

  return (
    <div className="container stack" style={{ gap: 16, marginTop: 24 }}>
      <h1>Receiver Ready</h1>

      <div className="card stack">
        <p>
          Room <span className="kbd">{roomCode || "—"}</span> • You:{" "}
          <span className="kbd">{me || "—"}</span>
        </p>

        {!total && !done && <p className="small">Waiting for the sender to start transfer…</p>}

        {total && !done && (
          <>
            <p>Receiving {name ? <b>{name}</b> : "file"}…</p>
            <ProgressBar value={received} total={total} />
            <div className="small">{pct}%</div>
          </>
        )}

        {done && <p>✅ Download started{name ? <>: <b>{name}</b></> : ""}.</p>}
      </div>

      <button className="btn secondary" onClick={softLeaveOrHardRedirect}>
        Leave Room
      </button>
    </div>
  )
}
