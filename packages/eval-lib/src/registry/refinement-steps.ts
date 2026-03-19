import type { RegistryEntry } from "./types.js";

export const REFINEMENT_STEP_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "rerank",
    name: "Rerank",
    description:
      "Reorders retrieved chunks using a cross-encoder reranker model for more accurate relevance scoring. The reranker provider and model are configured separately.",
    status: "available",
    tags: ["quality"],
    options: [],
    defaults: {},
  },
  {
    id: "threshold",
    name: "Threshold",
    description:
      "Filters out chunks whose relevance score falls below a minimum threshold. Removes low-confidence results to improve precision.",
    status: "available",
    tags: ["filtering"],
    options: [
      {
        key: "minScore",
        label: "Minimum Score",
        description:
          "Chunks with a relevance score below this threshold are discarded. Higher values are stricter, keeping only high-confidence results.",
        type: "number",
        default: 0.3,
        constraints: { min: 0, max: 1, step: 0.05 },
      },
    ],
    defaults: { minScore: 0.3 },
  },
  {
    id: "dedup",
    name: "Deduplication",
    description:
      "Removes duplicate or near-duplicate chunks from the result set. Prevents redundant content from consuming result slots.",
    status: "available",
    tags: ["filtering"],
    options: [
      {
        key: "method",
        label: "Method",
        description:
          "Deduplication strategy. Exact removes identical chunks; overlap removes chunks with high character overlap.",
        type: "select",
        choices: [
          {
            value: "exact",
            label: "Exact",
            description: "Remove only identical chunks",
          },
          {
            value: "overlap",
            label: "Overlap",
            description:
              "Remove chunks with character overlap above the threshold",
          },
        ],
        default: "overlap",
      },
      {
        key: "overlapThreshold",
        label: "Overlap Threshold",
        description:
          "Minimum character overlap ratio (0-1) to consider two chunks as duplicates. Only used when method is 'overlap'.",
        type: "number",
        default: 0.5,
        constraints: { min: 0, max: 1, step: 0.1 },
      },
    ],
    defaults: { method: "overlap", overlapThreshold: 0.5 },
  },
  {
    id: "mmr",
    name: "MMR",
    description:
      "Maximal Marginal Relevance: reranks results to balance relevance and diversity. Reduces redundancy by penalizing chunks similar to already-selected ones.",
    status: "available",
    tags: ["diversity"],
    options: [
      {
        key: "lambda",
        label: "Lambda",
        description:
          "Trade-off between relevance (1.0) and diversity (0.0). Lower values produce more diverse result sets.",
        type: "number",
        default: 0.7,
        constraints: { min: 0, max: 1, step: 0.1 },
      },
    ],
    defaults: { lambda: 0.7 },
  },
  {
    id: "expand-context",
    name: "Expand Context",
    description:
      "Expands each retrieved chunk by including surrounding characters from the original document. Provides additional context without changing the retrieval itself.",
    status: "available",
    tags: ["context"],
    options: [
      {
        key: "windowChars",
        label: "Window Characters",
        description:
          "Number of characters to include before and after each chunk from the source document.",
        type: "number",
        default: 500,
        constraints: { min: 50, max: 5000, step: 50 },
      },
    ],
    defaults: { windowChars: 500 },
  },
] as const;
