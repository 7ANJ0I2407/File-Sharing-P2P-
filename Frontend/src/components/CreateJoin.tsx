import React, { useState } from "react"
import { useSignal } from "../hooks/useSignal"

export default function CreateJoin({ signal }:{ signal: ReturnType<typeof useSignal> }) {
  const [code, setCode] = useState("")
  const canUse = ["open","mock","connecting"].includes(signal.status)

  return (
    <div className="card grid" style={{ gap:16 }}>
      <div className="stack">
        <div className="label">Status</div>
        <div>
          {signal.status === "connecting" && "Connecting..."}
          {signal.status === "open" && "Connected"}
          {signal.status === "mock" && "Mock mode (no server)"}
          {signal.status === "closed" && "Disconnected"}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="stack">
          <div className="label">Create a room (sender)</div>
          <button className="btn" disabled={!canUse} onClick={()=>signal.createRoom("sender")}>
            Create Room
          </button>
          {signal.roomCode && signal.role === "sender" && (
            <div className="stack">
              <div className="label">Room Code</div>
              <div className="code kbd" style={{ fontSize:22, letterSpacing:2 }}>{signal.roomCode}</div>
              <div className="small">Share this code with receivers.</div>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="label">Join a room (receiver)</div>
          <div className="row">
            <input className="input" placeholder="Enter code e.g. AB12CD"
              value={code} onChange={e=>setCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={!canUse || !code}
              onClick={()=>signal.joinRoom(code, "receiver")}>
              Join
            </button>
          </div>
          {signal.roomCode && signal.role === "receiver" && (
            <div className="small">Joined room <span className="kbd">{signal.roomCode}</span>. Waiting for sender…</div>
          )}
        </div>
      </div>
    </div>
  )
}
