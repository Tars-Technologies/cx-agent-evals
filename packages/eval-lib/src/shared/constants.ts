/** Number of chunks to embed in one API call / checkpoint batch */
export const EMBED_BATCH_SIZE = 200;

/** Deletion batch size for cleanup */
export const CLEANUP_BATCH_SIZE = 500;

/** Batch size for question inserts */
export const QUESTION_INSERT_BATCH_SIZE = 100;

/** Parallelism tiers for indexing WorkPool */
export const TIER_PARALLELISM = {
  free: 3,
  pro: 10,
  enterprise: 20,
} as const;
