import type { Client, Room, Role, ServerState } from "./types"
import { genPeerId, genRoomCode, now } from "./utils"

export const state: ServerState = {
  rooms: new Map()
}

export function createRoom(): Room {
  const code = genRoomCode(5)
  const room: Room = { code, createdAt: now(), members: new Map() }
  state.rooms.set(code, room)
  return room
}

export function getRoom(code: string) { return state.rooms.get(code) }

export function addClient(room: Room, ws: Client["ws"], role: Role): Client {
  const c: Client = { ws, role, peerId: genPeerId(), roomCode: room.code, isAlive: true }
  room.members.set(c.peerId, c)
  return c
}

export function removeClient(c: Client) {
  const room = state.rooms.get(c.roomCode)
  if (!room) return { roomGone: true, wasSender: c.role === "sender" }
  room.members.delete(c.peerId)
  const wasSender = c.role === "sender"
  const empty = room.members.size === 0
  if (empty || wasSender) state.rooms.delete(room.code)
  return { roomGone: empty || wasSender, wasSender }
}
