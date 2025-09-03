export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buf)
  const hex = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("")
  return hex
}
