// Frontend/src/lib/crypto.ts
export async function encryptFile(file: File) {
  const key = crypto.getRandomValues(new Uint8Array(32)); // AES-256
  const iv = crypto.getRandomValues(new Uint8Array(12));  // GCM 96-bit iv
  const ab = await file.arrayBuffer();
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, ab);
  return {
    blob: new Blob([ciphertext]),
    keyB64: btoa(String.fromCharCode(...key)),
    ivB64: btoa(String.fromCharCode(...iv)),
  };
}

export async function decryptToBlob(encBuf: ArrayBuffer, keyB64: string, ivB64: string, mime = "application/octet-stream") {
  const key = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const iv  = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, encBuf);
  return new Blob([plain], { type: mime });
}
