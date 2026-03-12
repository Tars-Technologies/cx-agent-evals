/** Number of chunks to embed in one API call / checkpoint batch.
 *  Each 1536-dim float64 embedding is ~12KB, so 50 × 12KB ≈ 600KB per
 *  mutation — keeps write bursts well under the 16MB/s Convex limit even
 *  when several indexDocument actions run concurrently. */
export const EMBED_BATCH_SIZE = 50;

/** Deletion batch size for cleanup.
 *  Embedded chunks are ~13KB each (content + 1536-dim vector), so 100
 *  chunks ≈ 1.3MB per read — safely within the 16MB read limit. */
export const CLEANUP_BATCH_SIZE = 100;

/** Batch size for question inserts */
export const QUESTION_INSERT_BATCH_SIZE = 100;

/** Parallelism tiers for indexing WorkPool */
export const TIER_PARALLELISM = {
  free: 3,
  pro: 10,
  enterprise: 20,
} as const;
