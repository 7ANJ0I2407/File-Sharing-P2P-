// Backend/src/index.ts
import * as http from "http";
import { buildHttpApp, initHttpExtras, createWSServer } from "./server";
import { config } from "process";


import "dotenv/config";
// dotenv.config(); // import .env

const PORT = Number(process.env.PORT || 8787);

// console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
// console.log("SUPABASE_SERVICE_ROLE =", process.env.SUPABASE_SERVICE_ROLE);


async function main() {
  const app = buildHttpApp();
  await initHttpExtras(); // init store + start sweeper

  const server = http.createServer(app); // <-- same server for HTTP + WS
  createWSServer(server);

  server.listen(PORT, () => {
    console.log(`HTTP/WS listening on http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`WS:     ws://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error("Boot failed:", err);
  process.exit(1);
});
