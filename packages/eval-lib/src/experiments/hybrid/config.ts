import type { PipelineConfig } from "../../retrievers/pipeline/config.js";

export const HYBRID_CONFIG: PipelineConfig = {
  name: "hybrid",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
};
