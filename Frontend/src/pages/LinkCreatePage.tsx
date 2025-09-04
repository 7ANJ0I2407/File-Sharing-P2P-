// Frontend/src/pages/LinkCreatePage.tsx
import React, { useState } from "react";
import { encryptFile } from "../lib/crypto";

const API = import.meta.env.VITE_API_BASE || ""; // same origin (empty) if served together

export default function LinkCreatePage() {
  const [file, setFile] = useState<File|null>(null);
  const [link, setLink] = useState<string>("");

  async function makeLink() {
    if (!file) return;
    // 1) init placeholder (1 hour default)
    const init = await fetch(`${API}/api/link/init`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlSeconds: 3600 })
    }).then(r => r.json());

    // 2) encrypt locally
    const { blob, keyB64, ivB64 } = await encryptFile(file);

    // 3) upload ciphertext
    await fetch(`${API}/api/link/${init.id}/upload?t=${init.token}`, {
      method: "POST",
      headers: {
        "x-file-name": encodeURIComponent(file.name),
        "x-iv": ivB64,
        "x-mime": file.type || "application/octet-stream",
        "x-size": String(file.size),
      },
      body: blob
    });

    // 4) Show share URL (key stays after #)
    const url = `${location.origin}/get/${init.id}?t=${init.token}#${keyB64}`;
    setLink(url);
  }

  return (
    <div className="container stack" style={{ gap: 12 }}>
      <h1>Expiring Link</h1>
      <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
      <button className="btn" disabled={!file} onClick={makeLink}>Create one-time link</button>
      {link && (
        <div className="card">
          <div className="small">Share this URL (one-time):</div>
          <code style={{ wordBreak: "break-all" }}>{link}</code>
        </div>
      )}
    </div>
  );
}
