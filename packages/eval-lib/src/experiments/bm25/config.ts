import type { PipelineConfig } from "../../retrievers/pipeline/config.js";

export const BM25_CONFIG: PipelineConfig = {
  name: "bm25",
  index: { strategy: "plain" },
  search: { strategy: "bm25" },
};
