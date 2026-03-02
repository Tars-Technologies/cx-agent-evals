import type { CharacterSpan, SpanRange } from "../../types/chunks.js";
import type { Metric } from "./base.js";
import { recall } from "./recall.js";
import { precision } from "./precision.js";

export const f1: Metric = {
  name: "f1" as const,
  calculate(retrieved: readonly CharacterSpan[], groundTruth: readonly CharacterSpan[]): number {
    const r = recall.calculate(retrieved, groundTruth);
    const p = precision.calculate(retrieved, groundTruth);
    if (r + p === 0) return 0.0;
    return (2 * p * r) / (p + r);
  },
  calculatePreMerged(
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ): number {
    const r = recall.calculatePreMerged!(mergedRetrieved, mergedGroundTruth);
    const p = precision.calculatePreMerged!(mergedRetrieved, mergedGroundTruth);
    if (r + p === 0) return 0.0;
    return (2 * p * r) / (p + r);
  },
};
