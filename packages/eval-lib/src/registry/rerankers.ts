import type { RegistryEntry } from "./types.js";

export const RERANKER_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "cohere",
    name: "Cohere",
    description:
      "Cross-encoder reranking models. rerank-english-v3.0 is proven and stable for English retrieval.",
    status: "available",
    tags: ["popular", "stable"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Cohere reranker model to use.",
        type: "select",
        choices: [
          {
            value: "rerank-english-v3.0",
            label: "rerank-english-v3.0",
            description:
              "English-only, proven stable — recommended default",
          },
          {
            value: "rerank-v3.5",
            label: "rerank-v3.5",
            description: "Latest multilingual model",
          },
          {
            value: "rerank-english-v2.0",
            label: "rerank-english-v2.0",
            description: "Legacy — use v3.0 unless benchmarking",
          },
        ],
        default: "rerank-english-v3.0",
      },
    ],
    defaults: { model: "rerank-english-v3.0" },
  },
  {
    id: "jina",
    name: "Jina",
    description:
      "Multilingual cross-encoder reranker from Jina AI. Good default for multilingual corpora.",
    status: "available",
    tags: ["multilingual"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Jina reranker model to use.",
        type: "select",
        choices: [
          {
            value: "jina-reranker-v2-base-multilingual",
            label: "jina-reranker-v2-base-multilingual",
            description:
              "Base multilingual reranker — good balance of speed and quality",
          },
        ],
        default: "jina-reranker-v2-base-multilingual",
      },
    ],
    defaults: { model: "jina-reranker-v2-base-multilingual" },
  },
  {
    id: "voyage",
    name: "Voyage",
    description:
      "Reranking model from Voyage AI. Pairs well with Voyage embedders for consistent scoring.",
    status: "available",
    tags: ["high-quality"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Voyage reranker model to use.",
        type: "select",
        choices: [
          {
            value: "rerank-2.5",
            label: "rerank-2.5",
            description: "Latest Voyage reranker",
          },
        ],
        default: "rerank-2.5",
      },
    ],
    defaults: { model: "rerank-2.5" },
  },
] as const;
