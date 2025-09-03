import type { WebSocket } from "ws"

export type Role = "sender" | "receiver"

export type Client = {
  ws: WebSocket
  peerId: string
  role: Role
  roomCode: string
  isAlive: boolean
}

export type Room = {
  code: string
  createdAt: number
  members: Map<string, Client> // peerId -> Client
  // you can extend (approved set, locks etc) if you want server-side checks
}

export type ServerState = {
  rooms: Map<string, Room>
}

export type MsgBase = { t: string }
export type CreateRoom = { t: "create_room"; role: Role }
export type JoinRoom = { t: "join_room"; roomCode: string; role: Role }
export type LeaveRoom = { t: "leave_room"; roomCode: string }
export type Relay = {
  t:
    | "offer" | "answer" | "ice"
    | "approve_join" | "request_send" | "grant_send" | "deny_send" | "transfer_release"
  roomCode: string
  to: string
  from: string
  sdp?: string
  candidate?: any
  sessionId?: string
  reason?: string
}

export type WSIn = CreateRoom | JoinRoom | LeaveRoom | Relay

export type WSOut =
  | { t: "room_created"; roomCode: string; peerId: string }
  | { t: "room_joined"; peerId: string; members: Array<{ peerId: string; role: Role }> }
  | { t: "peer_joined"; peerId: string; role: Role }
  | { t: "peer_left"; peerId: string }
  | { t: "room_closed"; roomCode: string }
  | Relay
  | { t: "error"; msg: string }
