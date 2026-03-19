import type { RegistryEntry } from "./types.js";

export const EMBEDDER_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    description:
      "Industry-standard embeddings with excellent English performance. text-embedding-3-small is fast and cost-effective.",
    status: "available",
    tags: ["popular", "fast"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "OpenAI embedding model to use.",
        type: "select",
        choices: [
          {
            value: "text-embedding-3-small",
            label: "text-embedding-3-small",
            description:
              "1536 dims — fast, cost-effective, recommended for most use cases",
          },
          {
            value: "text-embedding-3-large",
            label: "text-embedding-3-large",
            description: "3072 dims — highest quality, 6x more expensive",
          },
        ],
        default: "text-embedding-3-small",
      },
    ],
    defaults: { model: "text-embedding-3-small" },
  },
  {
    id: "cohere",
    name: "Cohere",
    description:
      "Dense retrieval embeddings optimized for search. Strong multilingual support with embed-multilingual-v3.0.",
    status: "available",
    tags: ["multilingual"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Cohere embedding model to use.",
        type: "select",
        choices: [
          {
            value: "embed-english-v3.0",
            label: "embed-english-v3.0",
            description:
              "1024 dims — English-optimized, best for English-only corpora",
          },
          {
            value: "embed-multilingual-v3.0",
            label: "embed-multilingual-v3.0",
            description: "1024 dims — supports 100+ languages",
          },
        ],
        default: "embed-english-v3.0",
      },
    ],
    defaults: { model: "embed-english-v3.0" },
  },
  {
    id: "voyage",
    name: "Voyage",
    description:
      "High-quality embeddings from Voyage AI. voyage-3.5 offers strong retrieval performance across domains.",
    status: "available",
    tags: ["high-quality"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Voyage embedding model to use.",
        type: "select",
        choices: [
          {
            value: "voyage-3.5",
            label: "voyage-3.5",
            description: "1024 dims — latest general-purpose model",
          },
          {
            value: "voyage-3.5-lite",
            label: "voyage-3.5-lite",
            description:
              "512 dims — faster, lower cost, slightly less accurate",
          },
          {
            value: "voyage-3",
            label: "voyage-3",
            description: "1024 dims — previous generation",
          },
          {
            value: "voyage-code-3",
            label: "voyage-code-3",
            description: "1024 dims — optimized for code retrieval",
          },
        ],
        default: "voyage-3.5",
      },
    ],
    defaults: { model: "voyage-3.5" },
  },
  {
    id: "jina",
    name: "Jina",
    description:
      "Flexible embeddings with Matryoshka dimension support. Adjust output dimensions (32-1024) for speed vs quality trade-off.",
    status: "available",
    tags: ["flexible", "matryoshka"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Jina embedding model to use.",
        type: "select",
        choices: [
          {
            value: "jina-embeddings-v3",
            label: "jina-embeddings-v3",
            description:
              "Up to 1024 dims — supports Matryoshka dimension reduction",
          },
        ],
        default: "jina-embeddings-v3",
      },
      {
        key: "dimensions",
        label: "Dimensions",
        description:
          "Output embedding dimensions (Matryoshka). Lower = faster search but less accurate. Only supported by jina-embeddings-v3.",
        type: "number",
        default: 1024,
        constraints: { min: 32, max: 1024, step: 32 },
        advanced: true,
      },
    ],
    defaults: { model: "jina-embeddings-v3", dimensions: 1024 },
  },
] as const;
