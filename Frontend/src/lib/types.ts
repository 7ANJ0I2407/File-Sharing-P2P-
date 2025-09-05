export type Role = "sender" | "receiver"

export type WSMsg =
  | { t:"create_room"; role:Role }
  | { t:"room_created"; roomCode:string; peerId:string }
  | { t:"join_room"; roomCode:string; role:Role }
  | { t:"room_joined"; roomCode:string; peerId:string; members:{peerId:string; role:Role}[] }
  | { t:"peer_joined"; peerId:string; role:Role }
  | { t:"peer_left"; peerId:string }
  | { t:"offer"; roomCode:string; to:string; from:string; sdp:string }
  | { t:"answer"; roomCode:string; to:string; from:string; sdp:string }
  | { t:"ice"; roomCode:string; to:string; from:string; candidate:RTCIceCandidateInit }
  | { t:"error"; msg:string }
  // --- control plane for approvals / locking ---
  | { t:"approve_join"; roomCode:string; to:string; from:string }                  // sender -> receiver
  | { t:"request_send"; roomCode:string; to:string; from:string }                  // receiver -> sender (ask to send)
  | { t:"grant_send"; roomCode:string; to:string; from:string; sessionId:string }  // sender -> receiver
  | { t:"deny_send"; roomCode:string; to:string; from:string; reason?:string }     // sender -> receiver
  | { t:"transfer_release"; roomCode:string; to:string; from:string; sessionId:string } // either -> counterpart

export type Member = { peerId:string; role:Role }

export type TransferMeta = {
  t: "meta"
  transferId: string
  name: string
  size: number
  mime: string
  chunkBytes: number
  sha256?: string
}
export type Ack = { t:"ack"; transferId:string; offset:number }
export type AckReq = { t:"ack_req"; transferId:string; offset:number }
export type ResumeQ = { t:"resume?"; transferId:string; receivedBytes:number }
export type Complete = { t:"complete"; transferId:string }
