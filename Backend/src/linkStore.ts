// Backend/src/linkStore.ts
import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";

export type LinkRec = {
  id: string;              // short id
  token: string;           // bearer token (query param)
  createdAt: number;       // ms
  expiresAt: number;       // ms
  used: boolean;           // one-time
  file: {
    objectKey: string;          // Supabase object key
    size: number;
    mime: string;
    filename: string;
    ivB64: string;         // AES-GCM IV (base64)
  };
};

const DATA_DIR = path.resolve(process.cwd(), "Backend/.data");
const META_FILE = path.join(DATA_DIR, "links.json");

let loaded = false;
const links = new Map<string, LinkRec>();

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(META_FILE, "utf8");
    const arr: LinkRec[] = JSON.parse(raw || "[]");
    for (const r of arr) links.set(r.id, r);
  } catch { /* first boot */ }
  loaded = true;
}
async function persist() {
  if (!loaded) await ensureDirs();
  await fs.writeFile(META_FILE, JSON.stringify([...links.values()], null, 2));
}

export async function initStore() { if (!loaded) await ensureDirs(); }

export function newId(n = 6) {
  return randomBytes(n).toString("base64url");
}
export function newToken(n = 12) {
  return randomBytes(n).toString("base64url");
}

export async function createPlaceholder(ttlMs: number): Promise<LinkRec> {
  const id = newId();
  const token = newToken();
  const now = Date.now();
  const rec: LinkRec = {
    id, token, createdAt: now, expiresAt: now + ttlMs, used: false,
    file: { objectKey: "", size: 0, mime: "application/octet-stream", filename: "file", ivB64: "" }
  };
  links.set(id, rec);
  await persist();
  return rec;
}

export async function attachFile(id: string, fileInfo: Pick<LinkRec["file"], "objectKey"|"size"|"mime"|"filename"|"ivB64">) {
  const rec = links.get(id); if (!rec) throw new Error("not_found");
  rec.file = { ...fileInfo };
  await persist();
}

export function get(id: string) { return links.get(id); }

export async function markUsedAndDelete(id: string) {
  const rec = links.get(id); if (!rec) return;
  rec.used = true;
//   try { if (rec.file.path) await fs.unlink(rec.file.path); } catch {}

  await persist();
}

export async function sweepExpired() {
  const now = Date.now();
  const doomed: string[] = [];
  for (const [id, rec] of links) {
    if (rec.used || rec.expiresAt <= now) doomed.push(id);
  }
  for (const id of doomed) links.delete(id);
  if (doomed.length) await persist();
}

export { DATA_DIR };
