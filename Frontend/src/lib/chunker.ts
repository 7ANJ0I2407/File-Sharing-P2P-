export const CHUNK_BYTES = 4 * 1024 * 1024 // 4MB logical chunk
export const FRAME_BYTES = 64 * 1024       // 64KB DC frame
export const BUF_LO = 1_000_000            // 1MB
export const BUF_HI = 2_000_000            // 2MB

export async function* readFileChunks(file: File, chunkSize = CHUNK_BYTES) {
  let offset = 0
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size)
    const buf = await file.slice(offset, end).arrayBuffer()
    yield { offset, end, buf }
    offset = end
  }
}

export function* frames(buf: ArrayBuffer, frameSize = FRAME_BYTES) {
  let i = 0
  while (i < buf.byteLength) {
    const end = Math.min(i + frameSize, buf.byteLength)
    yield buf.slice(i, end)
    i = end
  }
}
