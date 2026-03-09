import type { Document, PositionAwareChunk } from "../types/index.js";

/** Splits raw text into smaller segments for embedding. Does not track positions. */
export interface Chunker {
  /** Human-readable identifier (e.g., "recursive-character-500"). */
  readonly name: string;

  /**
   * Split text into chunk strings.
   * Suitable for embedding but not for span-based evaluation (no position info).
   */
  chunk(text: string): string[];
}

/**
 * Splits a document into chunks that carry character offsets (`start`/`end`)
 * relative to the original document text, enabling span-based evaluation metrics.
 * Required for any chunker that participates in the evaluation pipeline.
 */
export interface PositionAwareChunker {
  /** Human-readable identifier (e.g., "recursive-character-500"). */
  readonly name: string;

  /**
   * Split a document into chunks with character-level position tracking.
   * @returns Chunks whose `start`/`end` offsets map back to `doc.content`.
   */
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

/** Type guard that distinguishes a position-aware chunker from a plain chunker. */
export function isPositionAwareChunker(
  chunker: Chunker | PositionAwareChunker,
): chunker is PositionAwareChunker {
  return "chunkWithPositions" in chunker;
}

/**
 * Async variant of PositionAwareChunker for chunkers that need
 * async operations (embedding, LLM calls) during chunking.
 *
 * Implementations must set `readonly async = true as const` as a
 * discriminator property for the type guard.
 */
export interface AsyncPositionAwareChunker {
  readonly name: string;
  readonly async: true;
  chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;
}

/**
 * Type guard to distinguish async chunkers from sync chunkers.
 * Checks for the `async: true` discriminator property.
 */
export function isAsyncPositionAwareChunker(
  chunker: PositionAwareChunker | AsyncPositionAwareChunker,
): chunker is AsyncPositionAwareChunker {
  return "async" in chunker && (chunker as any).async === true;
}
