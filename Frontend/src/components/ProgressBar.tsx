import React from "react"

export default function ProgressBar({ value, total }: { value:number; total?:number }) {
  const pct = total ? Math.min(100, Math.round((value/total)*100)) : 0
  return (
    <div className="stack">
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      <div className="small">{total ? `${pct}%  (${fmt(value)} / ${fmt(total)})` : fmt(value)}</div>
    </div>
  )
}

function fmt(n:number) {
  const units = ["B","KB","MB","GB","TB"]
  let u = 0, x = n
  while (x >= 1024 && u < units.length-1) { x/=1024; u++ }
  return `${x.toFixed(1)} ${units[u]}`
}
