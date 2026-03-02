import type { CharacterSpan, SpanRange } from "../../types/chunks.js";
import type { Metric } from "./base.js";
import {
  calculateOverlap,
  calculateOverlapPreMerged,
  totalSpanLength,
  totalSpanLengthPreMerged,
} from "./utils.js";

export const iou: Metric = {
  name: "iou" as const,
  calculate(retrieved: readonly CharacterSpan[], groundTruth: readonly CharacterSpan[]): number {
    if (retrieved.length === 0 && groundTruth.length === 0) return 1.0;
    if (retrieved.length === 0 || groundTruth.length === 0) return 0.0;

    const intersection = calculateOverlap(retrieved, groundTruth);
    const totalRet = totalSpanLength(retrieved);
    const totalGt = totalSpanLength(groundTruth);
    const union = totalRet + totalGt - intersection;

    return union > 0 ? intersection / union : 0.0;
  },
  calculatePreMerged(
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ): number {
    if (mergedRetrieved.length === 0 && mergedGroundTruth.length === 0) return 1.0;
    if (mergedRetrieved.length === 0 || mergedGroundTruth.length === 0) return 0.0;

    const intersection = calculateOverlapPreMerged(mergedRetrieved, mergedGroundTruth);
    const totalRet = totalSpanLengthPreMerged(mergedRetrieved);
    const totalGt = totalSpanLengthPreMerged(mergedGroundTruth);
    const union = totalRet + totalGt - intersection;

    return union > 0 ? intersection / union : 0.0;
  },
};
