import type { RunResult } from "@convex-dev/workpool";

/**
 * Apply a WorkPool RunResult to job counters.
 * Shared by generation, indexing, and experiment callbacks.
 */
export function applyResult(
  job: {
    processedItems: number;
    failedItems: number;
    skippedItems: number;
    failedItemDetails?: Array<{ itemKey: string; error: string }>;
  },
  result: RunResult,
  itemKey: string,
) {
  const processedItems = job.processedItems + (result.kind === "success" ? 1 : 0);
  const failedItems = job.failedItems + (result.kind === "failed" ? 1 : 0);
  const skippedItems = job.skippedItems + (result.kind === "canceled" ? 1 : 0);
  const failedItemDetails = [...(job.failedItemDetails ?? [])];

  if (result.kind === "failed") {
    failedItemDetails.push({ itemKey, error: result.error });
  }

  return { processedItems, failedItems, skippedItems, failedItemDetails };
}

/**
 * Format counter values for a Convex db.patch() call.
 * Converts empty failedItemDetails arrays to undefined (removes field from document).
 */
export function counterPatch(counters: {
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  failedItemDetails: Array<{ itemKey: string; error: string }>;
}) {
  return {
    processedItems: counters.processedItems,
    failedItems: counters.failedItems,
    skippedItems: counters.skippedItems,
    failedItemDetails: counters.failedItemDetails.length > 0 ? counters.failedItemDetails : undefined,
  };
}
