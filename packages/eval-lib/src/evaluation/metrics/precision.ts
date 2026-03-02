import type { CharacterSpan, SpanRange } from "../../types/chunks.js";
import type { Metric } from "./base.js";
import {
  calculateOverlap,
  calculateOverlapPreMerged,
  totalSpanLength,
  totalSpanLengthPreMerged,
} from "./utils.js";

export const precision: Metric = {
  name: "precision" as const,
  calculate(retrieved: readonly CharacterSpan[], groundTruth: readonly CharacterSpan[]): number {
    if (retrieved.length === 0) return 0.0;
    const totalRetChars = totalSpanLength(retrieved);
    if (totalRetChars === 0) return 0.0;
    const overlap = calculateOverlap(retrieved, groundTruth);
    return Math.min(overlap / totalRetChars, 1.0);
  },
  calculatePreMerged(
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ): number {
    if (mergedRetrieved.length === 0) return 0.0;
    const totalRetChars = totalSpanLengthPreMerged(mergedRetrieved);
    if (totalRetChars === 0) return 0.0;
    const overlap = calculateOverlapPreMerged(mergedRetrieved, mergedGroundTruth);
    return Math.min(overlap / totalRetChars, 1.0);
  },
};
