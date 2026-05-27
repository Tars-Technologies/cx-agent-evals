export type { ComputeMetricsOptions } from "./evaluator.js"
export { computeMetrics } from "./evaluator.js"
export type { Metric } from "./metrics/base.js"
export { f1, iou, precision, recall } from "./metrics/index.js"
export {
  calculateOverlap,
  mergeOverlappingSpans,
  totalSpanLength
} from "./metrics/utils.js"
