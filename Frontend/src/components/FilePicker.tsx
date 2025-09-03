import React, { useRef } from "react"

export default function FilePicker({ onPick }: { onPick: (file: File)=>void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="row">
      <button className="btn secondary" onClick={()=>ref.current?.click()}>Choose file</button>
      <input ref={ref} type="file" style={{ display:"none" }}
             onChange={(e)=>{ const f=e.target.files?.[0]; if (f) onPick(f) }} />
    </div>
  )
}
