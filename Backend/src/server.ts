import { WebSocketServer, WebSocket } from "ws"
import { randomBytes } from "crypto"

// Types
type Role = "sender" | "receiver"
type Client = { ws: WebSocket; room?: string; peerId?: string; role?: Role; isAlive: boolean }
type Room = Map<string, Client>

// In-memory rooms
const rooms: Record<string, Room> = {}

// Utils
const rid = (n = 4) => randomBytes(n).toString("base64url").toUpperCase()
const pid = () => `p_${randomBytes(3).toString("hex")}`

function broadcast(room: Room, msg: any, except?: string) {
  const json = JSON.stringify(msg)
  for (const [id, cl] of room) {
    if (id === except) continue
    try { cl.ws.send(json) } catch {}
  }
}

function removeFromRoom(c: Client) {
  if (!c.room || !c.peerId) return
  const code = c.room
  const room = rooms[code]
  if (!room) { c.room = undefined; c.peerId = undefined; return }

  const leftId = c.peerId
  const leftRole = c.role
  room.delete(leftId)

  // notify survivors someone left
  broadcast(room, { t: "peer_left", peerId: leftId })

  // If sender left, close the room for everyone else
  if (leftRole === "sender") {
    broadcast(room, { t: "room_closed", roomCode: code })
    delete rooms[code]
  } else if (room.size === 0) {
    delete rooms[code]
  }

  c.room = undefined
  c.peerId = undefined
}

// ---- WebSocket server ----
const PORT = Number(process.env.PORT || 8787)
const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws: WebSocket) => {
  const c: Client = { ws, isAlive: true }

  ws.on("pong", () => { c.isAlive = true })

  ws.on("message", (raw: Buffer) => {
    let m: any
    try { m = JSON.parse(String(raw)) } catch { return }

    if (m.t === "create_room") {
      const code = rid(4)
      rooms[code] ||= new Map()
      c.room = code
      c.peerId = pid()
      c.role = m.role as Role
      rooms[code].set(c.peerId, c)
      ws.send(JSON.stringify({ t: "room_created", roomCode: code, peerId: c.peerId }))
      return
    }

    if (m.t === "join_room") {
      const room = rooms[m.roomCode]
      if (!room) { ws.send(JSON.stringify({ t: "error", msg: "bad_room" })); return }
      c.room = m.roomCode
      c.peerId = pid()
      c.role = m.role as Role
      room.set(c.peerId, c)
      const members = [...room.entries()]
        .filter(([id]) => id !== c.peerId)
        .map(([peerId, cl]) => ({ peerId, role: cl.role! }))
      ws.send(JSON.stringify({ t: "room_joined", peerId: c.peerId, members }))
      broadcast(room, { t: "peer_joined", peerId: c.peerId, role: c.role }, c.peerId)
      return
    }

    if (m.t === "leave_room") {
      removeFromRoom(c)
      return
    }

    // Relay signaling + control
    if (["offer","answer","ice","approve_join","request_send","grant_send","deny_send","transfer_release"].includes(m.t)) {
      const room = rooms[m.roomCode]; if (!room) return
      const target = room.get(m.to as string); if (!target) return
      try { target.ws.send(JSON.stringify(m)) } catch {}
      return
    }
  })

  ws.on("close", () => { removeFromRoom(c) })
})

// Heartbeat to drop dead sockets and notify peers
setInterval(() => {
  for (const room of Object.values(rooms)) {
    for (const cl of room.values()) {
      if (!cl.isAlive) {
        try { cl.ws.terminate() } catch {}
        removeFromRoom(cl)
        continue
      }
      cl.isAlive = false
      try { cl.ws.ping() } catch {}
    }
  }
}, 10_000)

console.log(`ws://localhost:${PORT}`)
