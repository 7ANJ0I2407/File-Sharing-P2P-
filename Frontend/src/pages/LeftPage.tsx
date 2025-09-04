// Frontend/src/pages/LeftPage.tsx
import React from "react";
import LinkCreatePage from "./LinkCreatePage";

export default function LeftPage() {
  return (
    <div className="container stack" style={{ gap: 16, marginTop: 12 }}>
      <h1>Expiring, One-Time Link</h1>
      <p className="small">
        Encrypts in your browser. Server stores only ciphertext. The link burns on first download.
      </p>
      <LinkCreatePage />
      <div className="card small">
        Tip: open the generated link in an incognito window to test the one-time behavior.
      </div>
    </div>
  );
}
