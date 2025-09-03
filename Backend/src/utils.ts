import crypto from "crypto"
import type { WebSocket } from "ws"

export const now = () => Date.now()

export function genRoomCode(len = 5) {
  // A-Z0-9, unambiguous
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  const bytes = crypto.randomBytes(len)
  let out = ""
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

export function genPeerId() {
  return "p_" + crypto.randomBytes(3).toString("hex")
}

export function sendJSON(ws: WebSocket, obj: any) {
  try { ws.send(JSON.stringify(obj)) } catch {}
}
