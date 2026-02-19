import type { PipelineConfig } from "../../retrievers/pipeline/config.js";

export const BASELINE_VECTOR_RAG_CONFIG: PipelineConfig = {
  name: "baseline-vector-rag",
  index: { strategy: "plain" },
  search: { strategy: "dense" },
};
