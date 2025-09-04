// Frontend/src/pages/LinkGetPage.tsx
import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { decryptToBlob } from "../lib/crypto";

const API = import.meta.env.VITE_API_BASE || "";

export default function LinkGetPage() {
  const { id } = useParams();
  const [q] = useSearchParams();
  const keyB64 = location.hash.slice(1);
  const token  = q.get("t") || "";
  const [status, setStatus] = useState("Preparing…");

  const ran = useRef(false); // ⭐ prevents StrictMode double-run

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        if (!keyB64) { setStatus("Missing key in URL hash (#...)"); return; }

        setStatus("Downloading…");
        const res = await fetch(`${API}/api/link/${id}/download?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) {
          const msg = await res.text().catch(()=> "");
          setStatus(`Error ${res.status}: ${msg || res.statusText}`);
          return;
        }

        const ivB64 = res.headers.get("X-IV") || "";
        const name  = decodeURIComponent(res.headers.get("X-File-Name") || "file");
        const mime  = res.headers.get("X-Mime") || "application/octet-stream";
        if (!ivB64) { setStatus("Missing IV header"); return; }

        const buf = await res.arrayBuffer();
        setStatus("Decrypting…");
        const blob = await decryptToBlob(buf, keyB64, ivB64, mime);

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setStatus("Done ✔ (Link is now invalid)");
      } catch (e: any) {
        setStatus("Failed: " + (e?.message || String(e)));
      }
    })();
  }, [id, token, keyB64]);

  return (
    <div className="container stack" style={{ gap: 12 }}>
      <h1>Fetching…</h1>
      <div>{status}</div>
    </div>
  );
}
