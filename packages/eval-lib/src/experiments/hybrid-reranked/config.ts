import type { PipelineConfig } from "../../retrievers/pipeline/config.js";

export const HYBRID_RERANKED_CONFIG: PipelineConfig = {
  name: "hybrid-reranked",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
  refinement: [{ type: "rerank" }],
};
