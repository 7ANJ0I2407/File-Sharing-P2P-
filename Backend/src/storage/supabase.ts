// Backend/src/storage/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";

const BUCKET = "links";
let client: SupabaseClient | null = null;

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (check .env and dotenv load order)`);
  return v;
}


function getClient() {
  if (!client) {
    const url = required("SUPABASE_URL");
    const key = required("SUPABASE_SERVICE_ROLE"); // server-only!
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client!;
}

export async function putObject(id: string, buf: Buffer) {
  const supabase = getClient();
  const { error } = await supabase.storage.from(BUCKET).upload(id, buf, {
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (error) throw error;
}

export async function getObjectStream(id: string) {
  const supabase = getClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(id);
  if (error) throw error;
  const arr = await data.arrayBuffer();
  return Readable.from(Buffer.from(arr));
}

export async function deleteObject(id: string) {
  const supabase = getClient();
  const { error } = await supabase.storage.from(BUCKET).remove([id]);
  if (error) throw error;
}
