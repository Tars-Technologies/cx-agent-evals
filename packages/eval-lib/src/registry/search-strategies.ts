import type { RegistryEntry } from "./types.js";

export const SEARCH_STRATEGY_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "dense",
    name: "Dense",
    description:
      "Vector similarity search using embedded representations. Finds semantically similar content even when exact keywords differ. The standard approach for most RAG systems.",
    status: "available",
    tags: ["semantic"],
    options: [],
    defaults: {},
  },
  {
    id: "bm25",
    name: "BM25",
    description:
      "Classic sparse keyword search using term frequency and document length normalization. Excels at exact-match and keyword-heavy queries.",
    status: "available",
    tags: ["keyword", "sparse"],
    options: [
      {
        key: "k1",
        label: "k1",
        description:
          "Term frequency saturation parameter. Higher values increase the impact of term frequency on scoring.",
        type: "number",
        default: 1.2,
        constraints: { min: 0, max: 3, step: 0.1 },
      },
      {
        key: "b",
        label: "b",
        description:
          "Document length normalization factor. 0 disables length normalization; 1 fully normalizes by document length.",
        type: "number",
        default: 0.75,
        constraints: { min: 0, max: 1, step: 0.05 },
      },
    ],
    defaults: { k1: 1.2, b: 0.75 },
  },
  {
    id: "hybrid",
    name: "Hybrid",
    description:
      "Combines dense vector search and sparse keyword search, fusing their results. Captures both semantic similarity and exact keyword matches for more robust retrieval.",
    status: "available",
    tags: ["semantic", "keyword"],
    options: [
      {
        key: "denseWeight",
        label: "Dense Weight",
        description:
          "Weight given to the dense (vector) search results in the fusion. Higher values favor semantic matching.",
        type: "number",
        default: 0.7,
        constraints: { min: 0, max: 1, step: 0.1 },
      },
      {
        key: "sparseWeight",
        label: "Sparse Weight",
        description:
          "Weight given to the sparse (BM25) search results in the fusion. Higher values favor keyword matching.",
        type: "number",
        default: 0.3,
        constraints: { min: 0, max: 1, step: 0.1 },
      },
      {
        key: "fusionMethod",
        label: "Fusion Method",
        description:
          "How to combine dense and sparse results. Weighted averages scores directly; RRF uses rank positions and is more robust to score distribution differences.",
        type: "select",
        choices: [
          {
            value: "weighted",
            label: "Weighted",
            description: "Weighted average of normalized scores",
          },
          {
            value: "rrf",
            label: "RRF",
            description:
              "Reciprocal Rank Fusion -- rank-based, no score calibration needed",
          },
        ],
        default: "weighted",
      },
      {
        key: "candidateMultiplier",
        label: "Candidate Multiplier",
        description:
          "Multiplier for the number of candidates to retrieve from each source before fusion. Higher values improve fusion quality at the cost of speed.",
        type: "number",
        default: 4,
        constraints: { min: 1, max: 10, step: 1 },
      },
      {
        key: "k1",
        label: "k1",
        description:
          "BM25 term frequency saturation parameter. Higher values increase the impact of term frequency on scoring.",
        type: "number",
        default: 1.2,
        constraints: { min: 0, max: 3, step: 0.1 },
        advanced: true,
      },
      {
        key: "b",
        label: "b",
        description:
          "BM25 document length normalization factor. 0 disables length normalization; 1 fully normalizes by document length.",
        type: "number",
        default: 0.75,
        constraints: { min: 0, max: 1, step: 0.05 },
        advanced: true,
      },
    ],
    defaults: {
      denseWeight: 0.7,
      sparseWeight: 0.3,
      fusionMethod: "weighted",
      candidateMultiplier: 4,
      k1: 1.2,
      b: 0.75,
    },
  },
] as const;
