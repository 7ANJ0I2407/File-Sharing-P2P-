// Frontend/src/App.tsx
import React from "react"
import { BrowserRouter, Routes, Route, Link } from "react-router-dom"
import "./styles.css"
import Home from "./pages/Home"
import P2PPage from "./pages/P2PPage"
import LeftPage from "./pages/LeftPage"
import WaitingPage from "./pages/WaitingPage"
import LinkGetPage from "./pages/LinkGetPage"   // ⭐ add

export default function App() {
  return (
    <BrowserRouter>
      <nav className="card row" style={{ gap: 16, alignItems: "center", margin: 16 }}>
        <Link to="/" className="btn secondary">Home</Link>
        <Link to="/p2p" className="btn">P2P</Link>
        <Link to="/once" className="btn secondary">Download Once</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p2p" element={<P2PPage />} />
        <Route path="/once" element={<LeftPage />} />
        {/* must exist and take no props */}
        <Route path="/waiting" element={<WaitingPage />} />
        {/* ⭐ new route to redeem a link */}
        <Route path="/get/:id" element={<LinkGetPage />} />
      </Routes>
    </BrowserRouter>
  )
}
