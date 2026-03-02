import type { CharacterSpan, SpanRange } from "../../types/chunks.js";
import type { Metric } from "./base.js";
import {
  calculateOverlap,
  calculateOverlapPreMerged,
  totalSpanLength,
  totalSpanLengthPreMerged,
} from "./utils.js";

export const recall: Metric = {
  name: "recall" as const,
  calculate(retrieved: readonly CharacterSpan[], groundTruth: readonly CharacterSpan[]): number {
    if (groundTruth.length === 0) return 1.0;
    const totalGtChars = totalSpanLength(groundTruth);
    if (totalGtChars === 0) return 1.0;
    const overlap = calculateOverlap(retrieved, groundTruth);
    return Math.min(overlap / totalGtChars, 1.0);
  },
  calculatePreMerged(
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ): number {
    if (mergedGroundTruth.length === 0) return 1.0;
    const totalGtChars = totalSpanLengthPreMerged(mergedGroundTruth);
    if (totalGtChars === 0) return 1.0;
    const overlap = calculateOverlapPreMerged(mergedRetrieved, mergedGroundTruth);
    return Math.min(overlap / totalGtChars, 1.0);
  },
};
