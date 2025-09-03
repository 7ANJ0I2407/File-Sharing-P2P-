import React from "react"
import { Link } from "react-router-dom"
import "../styles.css"

export default function Home() {
  return (
    <div className="container grid" style={{ gap: 16, marginTop: 24 }}>
      <h1>ShareIt — Choose a mode</h1>

      <div className="grid cols-2">
        <div className="card stack">
          <h2>P2P (Live)</h2>
          <p className="small">Instant browser-to-browser sharing. No server storage.</p>
          <Link to="/p2p" className="btn" style={{ textAlign: "center" }}>Go to P2P</Link>
        </div>

        <div className="card stack">
          <h2>Left (Later)</h2>
          <p className="small">Leave an expiring, encrypted link (coming soon).</p>
          <Link to="/left" className="btn secondary" style={{ textAlign: "center" }}>Preview Left</Link>
        </div>
      </div>
    </div>
  )
}
