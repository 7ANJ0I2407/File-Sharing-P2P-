import React, { useEffect, useMemo, useState } from "react"
import type { Member } from "../lib/types"
import PeerItem from "./PeerItem"
import FilePicker from "./FilePicker"
import ProgressBar from "./ProgressBar"

type Props = {
  role: "sender" | "receiver"
  roomCode: string
  me: string
  members: Member[]
  peerState: Record<string, { approved: boolean; locked: boolean; sessionId?: string; wantsToSend?: boolean }>
  onApprove: (peerId: string) => void
  onGrantSend: (peerId: string) => void
  onDenySend: (peerId: string) => void
  onRequestSend: (peerId: string) => void
  sendWS: (m: any) => void
  onWS: (cb: (m: any) => void) => () => void
  peers: Map<string, any>
  ingestSignal: (m: any) => void
  sendFileTo: (peerId: string, file: File) => void
  sendFileToMany: (peerIds: string[], file: File) => void
  leaveRoom?: () => void
}

export default function RoomView(p: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [file, setFile] = useState<File | null>(null)

  const sender = useMemo(() => p.members.find(m => m.role === "sender"), [p.members])
  const receivers = useMemo(() => p.members.filter(m => m.role === "receiver"), [p.members])

  useEffect(() => {
    setSelected(prev => {
      const next: Record<string, boolean> = {}
      for (const r of receivers) next[r.peerId] = prev[r.peerId] ?? true
      return next
    })
  }, [receivers.map(r => r.peerId).join("|")])

  // ---------- SENDER VIEW ----------
  if (p.role === "sender") {
    const pending = receivers.filter(r => !p.peerState[r.peerId]?.approved)
    const approved = receivers.filter(r => p.peerState[r.peerId]?.approved)

    return (
      <div className="card grid" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row"><span className="badge">sender</span><div className="code kbd">me: {p.me}</div></div>
          <div className="row"><div className="label">Room</div><div className="code kbd">{p.roomCode}</div></div>
        </div>

        <section className="stack">
          <h3>Join requests</h3>
          {pending.length === 0 && <div className="small">No pending receivers.</div>}
          <div className="grid">
            {pending.map(r => (
              <div key={r.peerId} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row"><strong>{r.peerId}</strong><span className="badge">receiver</span></div>
                  <button className="btn" onClick={() => p.onApprove(r.peerId)}>Approve</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h3>Approved receivers</h3>
          {approved.length === 0 && <div className="small">No approved receivers yet.</div>}
          <div className="grid">
            {approved.map(r => {
              const st = p.peerState[r.peerId] || { approved: false, locked: false }
              const prog = p.peers.get(r.peerId)
              return (
                <div key={r.peerId} className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div className="row">
                      <strong>{r.peerId}</strong><span className="badge">receiver</span>
                      {st.locked ? <span className="badge">locked</span> : <span className="badge">idle</span>}
                    </div>
                    <div className="row">
                      {st.wantsToSend && !st.locked && (
                        <>
                          <button className="btn" onClick={() => p.onGrantSend(r.peerId)}>Allow send</button>
                          <button className="btn secondary" onClick={() => p.onDenySend(r.peerId)}>Deny</button>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <PeerItem
                      peerId={r.peerId}
                      checked={true}
                      onToggle={() => {}}
                      sent={prog?.sentBytes || 0}
                      total={file?.size}
                    />
                  </div>

                  <div className="stack">
                    <div className="label">Pick file to send (you → {r.peerId})</div>
                    <div className="row">
                      <FilePicker onPick={setFile} />
                      <button
                        className="btn"
                        disabled={!file || st.locked}
                        onClick={() => file && p.sendFileTo(r.peerId, file)}
                      >
                        Send file
                      </button>
                    </div>
                    {file && <div className="small">{file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {p.leaveRoom && (
          <button className="btn secondary" onClick={p.leaveRoom}>Leave Room</button>
        )}
      </div>
    )
  }

  // ---------- RECEIVER VIEW ----------
  const mySender = sender
  const st = mySender ? (p.peerState[mySender.peerId] || { approved: false, locked: false }) : { approved: false, locked: false }
  const myConn = mySender ? p.peers.get(mySender.peerId) : undefined

  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row"><span className="badge">receiver</span><div className="code kbd">me: {p.me}</div></div>
        <div className="row"><div className="label">Room</div><div className="code kbd">{p.roomCode}</div></div>
      </div>

      {!mySender && <div className="small">Waiting for sender to appear…</div>}

      {mySender && !st.approved && (
        <div className="card" style={{ padding: 12 }}>
          <h3>Waiting for approval…</h3>
          <div className="small">The sender must approve your join before transfer.</div>
        </div>
      )}

      {mySender && st.approved && (
        <>
          <div className="card" style={{ padding: 12 }}>
            <h3>{st.locked ? "Transfer in progress…" : "Waiting for file…"}</h3>
            <div className="small">You can also request permission to send a file to the sender.</div>
            <div className="row" style={{ marginTop: 8 }}>
              <FilePicker onPick={setFile} />
              <button
                className="btn"
                disabled={!file || st.locked}
                onClick={() => p.onRequestSend(mySender.peerId)}
              >
                Request to Transfer (me → sender)
              </button>
              <button
                className="btn"
                disabled={!file || !st.locked}
                onClick={() => mySender && file && p.sendFileTo(mySender.peerId, file)}
              >
                Send now
              </button>
            </div>
            {file && <div className="small">{file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
          </div>

          <div className="stack">
            <div className="label">Progress</div>
            <ProgressBar value={myConn?.receivedBytes || 0} total={myConn?.fileSize} />
          </div>
        </>
      )}

      {p.leaveRoom && (
        <button className="btn secondary" onClick={p.leaveRoom}>Leave Room</button>
      )}
    </div>
  )
}
