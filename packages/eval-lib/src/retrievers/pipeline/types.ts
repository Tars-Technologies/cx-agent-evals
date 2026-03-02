import type { PositionAwareChunk } from "../../types/chunks.js";

/** A chunk paired with a relevance score. */
export interface ScoredChunk {
  readonly chunk: PositionAwareChunk;
  readonly score: number;
}
