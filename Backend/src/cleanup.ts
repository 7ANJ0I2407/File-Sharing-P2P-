// Backend/src/cleanup.ts
import { sweepExpired } from "./linkStore";

export function startSweeper() {
  setInterval(() => { sweepExpired().catch(() => {}); }, 60_000); // every minute
}
