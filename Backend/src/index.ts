import http from "http"
import { createWSServer } from "./server"

const PORT = Number(process.env.PORT || 8787)

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end(JSON.stringify({ ok: true }))
  }
  res.writeHead(404); res.end()
})

createWSServer(server)

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/health`)
  console.log(`ws://localhost:${PORT}`)
})
