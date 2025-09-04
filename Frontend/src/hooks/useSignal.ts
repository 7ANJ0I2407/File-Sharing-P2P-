// src/hooks/useSignal.ts
import React, { useEffect, useState } from "react"
import type { WSMsg, Member, Role } from "../lib/types"

type Status = "connecting" | "open" | "closed" | "mock"

// ---------- module-level singleton state ----------
let singleton:
  | {
      ws: WebSocket | null
      status: Status
      roomCode: string
      peerId: string
      role: Role
      members: Member[]
      sendQueue: WSMsg[]
      retry: number
      onopenHandlers: Set<() => void>
      // listeners for component state mirroring
      subs: Set<(s: {
        status: Status; roomCode: string; peerId: string; role: Role; members: Member[]
      }) => void>
    }
  | null = null

function ensureSingleton(url?: string, allowMock = true) {
  if (singleton) return singleton

  singleton = {
    ws: null,
    status: url ? "connecting" : (allowMock ? "mock" : "closed"),
    roomCode: "",
    peerId: "",
    role: "sender",
    members: [],
    sendQueue: [],
    retry: 0,
    onopenHandlers: new Set(),
    subs: new Set(),
  }

  if (!url) return singleton // mock mode

  let cancelled = false

  const update = (patch: Partial<Pick<NonNullable<typeof singleton>, "status"|"roomCode"|"peerId"|"members">>) => {
    singleton = { ...singleton!, ...patch }
    const snapshot = {
      status: singleton!.status,
      roomCode: singleton!.roomCode,
      peerId: singleton!.peerId,
      role: singleton!.role,
      members: singleton!.members,
    }
    for (const sub of singleton!.subs) try { sub(snapshot) } catch {}
  }

  const connect = () => {
    if (cancelled) return
    const ws = new WebSocket(url!)
    singleton!.ws = ws
    update({ status: "connecting" })

    ws.onopen = () => {
      if (cancelled || singleton?.ws !== ws) return
      singleton!.retry = 0
      update({ status: "open" })
      // flush queue
      for (const m of singleton!.sendQueue) ws.send(JSON.stringify(m))
      singleton!.sendQueue = []
      // let any late-join components attach listeners
      for (const fn of singleton!.onopenHandlers) try { fn() } catch {}
    }

    ws.onmessage = (ev) => {
      if (cancelled || singleton?.ws !== ws) return
      const m: WSMsg = JSON.parse(ev.data)

      if (m.t === "room_created") {
        update({ roomCode: m.roomCode, peerId: m.peerId, members: [] })
      } else if (m.t === "room_joined") {
        update({ peerId: m.peerId, members: m.members })
      } else if (m.t === "peer_joined") {
        const members = [
          ...singleton!.members.filter(p => p.peerId !== m.peerId),
          { peerId: m.peerId, role: m.role }
        ]
        update({ members })
      } else if (m.t === "peer_left") {
        const members = singleton!.members.filter(p => p.peerId !== m.peerId)
        update({ members })
      } else if ((m as any).t === "room_closed") {
        // force all clients out
        update({ members: [], roomCode: "", peerId: "" })
        window.dispatchEvent(new CustomEvent("room-closed", { detail: { roomCode: (m as any).roomCode } }))
      }

      // fan-out raw message to any component-scoped handlers
      ws.dispatchEvent(new MessageEvent("message-proxy", { data: ev.data }))
    }

    ws.onclose = () => {
      if (cancelled || singleton?.ws !== ws) return
      update({ status: "closed" })
      const n = Math.min(5, (singleton!.retry || 0) + 1)
      singleton!.retry = n
      const delay = 300 * n
      setTimeout(connect, delay)
    }

    ws.onerror = () => { /* onclose does the retry */ }
  }

  connect()

  // expose a cancel hook for HMR/unmount (not strictly needed in app)
  ;(window as any).__signal_cancel__ = () => { cancelled = true }

  return singleton
}

// ---------- hook ----------
export function useSignal() {
  const url = import.meta.env.VITE_SIGNAL_URL as string | undefined
  const allowMock = (import.meta.env.VITE_SIGNAL_ALLOW_MOCK ?? "1") !== "0"
  const s = ensureSingleton(url, allowMock)

  const [snap, setSnap] = useState({
    status: s.status, roomCode: s.roomCode, peerId: s.peerId, role: s.role, members: s.members
  })

  useEffect(() => {
    const sub = (x: typeof snap) => setSnap(x)
    s.subs.add(sub)
    return () => { s.subs.delete(sub) }
  }, [])

  // keep onbeforeunload leave
  useEffect(() => {
    const onUnload = () => { try { leaveRoom() } catch {} }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [snap.roomCode, snap.peerId])

  const send = (msg: WSMsg) => {
    const ws = s.ws
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    else s.sendQueue.push(msg)
  }

  function createRoom(r: Role = "sender") {
    s.role = r
    send({ t: "create_room", role: r })
  }
  function joinRoom(code: string, r: Role = "receiver") {
    s.role = r
    send({ t: "join_room", roomCode: code, role: r })
  }
  function leaveRoom() {
    if (!snap.roomCode || !snap.peerId) return
    try { send({ t: "leave_room", roomCode: snap.roomCode } as any) } catch {}
    // clear local snapshot immediately
    setSnap(prev => ({ ...prev, roomCode: "", peerId: "", members: [] }))
  }

  // component-scoped message listener (attaches even if WS not open yet)
  const onMessage = React.useCallback((cb: (m: WSMsg) => void) => {
    const ws = s.ws
    const handler = (ev: MessageEvent) => {
      const msg: WSMsg = JSON.parse(ev.data as any)
      if (
        msg.t === "offer" || msg.t === "answer" || msg.t === "ice" ||
        msg.t === "error" || msg.t === "approve_join" || msg.t === "grant_send" ||
        msg.t === "deny_send" || msg.t === "transfer_release" || msg.t === "request_send" ||
        (msg as any).t === "room_closed"
      ) cb(msg)
    }
    if (!ws) {
      const attach = () => {
        s.onopenHandlers.delete(attach)
        s.ws?.addEventListener("message-proxy", handler as EventListener)
      }
      s.onopenHandlers.add(attach)
    } else {
      ws.addEventListener("message-proxy", handler as EventListener)
    }
    return () => s.ws?.removeEventListener("message-proxy", handler as EventListener)
  }, [])

  return {
    status: snap.status,
    connected: snap.status === "open",
    roomCode: snap.roomCode,
    peerId: snap.peerId,
    role: snap.role,
    members: snap.members,
    setRole: (r: Role) => { s.role = r },
    send,
    createRoom,
    joinRoom,
    onMessage,
    leaveRoom
  }
}
