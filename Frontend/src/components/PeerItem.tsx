import React from "react"
import ProgressBar from "./ProgressBar"

type Props = {
  peerId: string
  checked: boolean
  onToggle: () => void
  sent: number
  total?: number
}

export default function PeerItem({ peerId, checked, onToggle, sent, total }: Props) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent:"space-between" }}>
        <div className="row">
          <input type="checkbox" checked={checked} onChange={onToggle} />
          <div style={{ fontWeight:700 }}>{peerId}</div>
          <span className="badge">receiver</span>
        </div>
      </div>
      <div style={{ marginTop:8 }}>
        <ProgressBar value={sent} total={total} />
      </div>
    </div>
  )
}
