import { createHash } from "node:crypto";
import { PositionAwareChunkId } from "../types/primitives.js";

export function generatePaChunkId(
  content: string,
  docId?: string,
  start?: number,
): PositionAwareChunkId {
  const input = docId != null ? `${docId}:${start}:${content}` : content;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return PositionAwareChunkId(`pa_chunk_${hash}`);
}
