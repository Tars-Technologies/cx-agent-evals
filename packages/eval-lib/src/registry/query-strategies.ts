import type { RegistryEntry } from "./types.js";

export const QUERY_STRATEGY_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "identity",
    name: "Identity",
    description:
      "Passes the user query through to search unchanged. No query transformation or expansion. The simplest and fastest approach, recommended as a baseline.",
    status: "available",
    options: [],
    defaults: {},
  },
  {
    id: "hyde",
    name: "HyDE",
    description:
      "Hypothetical Document Embeddings: generates a hypothetical answer to the query, then uses that answer's embedding for retrieval. Bridges the vocabulary gap between questions and documents.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "numHypotheticalDocs",
        label: "Hypothetical Documents",
        description:
          "Number of hypothetical documents to generate. More documents increase recall but add latency and cost.",
        type: "number",
        default: 1,
        constraints: { min: 1, max: 5, step: 1 },
      },
      {
        key: "hydePrompt",
        label: "HyDE Prompt",
        description:
          "Custom prompt template for generating hypothetical documents. Leave empty to use the built-in default.",
        type: "string",
        default: "",
        advanced: true,
      },
    ],
    defaults: { numHypotheticalDocs: 1, hydePrompt: "" },
  },
  {
    id: "multi-query",
    name: "Multi-Query",
    description:
      "Generates multiple reformulations of the original query, retrieves for each, and fuses the results. Improves recall by covering different phrasings.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "numQueries",
        label: "Number of Queries",
        description:
          "How many query variations to generate. More queries improve recall but increase latency linearly.",
        type: "number",
        default: 3,
        constraints: { min: 2, max: 10, step: 1 },
      },
      {
        key: "fusionMethod",
        label: "Fusion Method",
        description:
          "How to combine results from multiple queries. RRF (Reciprocal Rank Fusion) is robust; weighted averages scores directly.",
        type: "select",
        choices: [
          {
            value: "rrf",
            label: "RRF",
            description:
              "Reciprocal Rank Fusion -- rank-based, no score calibration needed",
          },
          {
            value: "weighted",
            label: "Weighted",
            description:
              "Weighted average of normalized scores",
          },
        ],
        default: "rrf",
      },
      {
        key: "generationPrompt",
        label: "Generation Prompt",
        description:
          "Custom prompt template for generating query variations. Leave empty to use the built-in default.",
        type: "string",
        default: "",
        advanced: true,
      },
    ],
    defaults: { numQueries: 3, fusionMethod: "rrf", generationPrompt: "" },
  },
  {
    id: "step-back",
    name: "Step-Back",
    description:
      "Generates a more abstract 'step-back' question, retrieves for both the original and abstract query, and merges results. Helps when specific queries miss relevant broader context.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "includeOriginal",
        label: "Include Original Query",
        description:
          "Whether to also retrieve using the original query in addition to the step-back query.",
        type: "boolean",
        default: true,
      },
      {
        key: "stepBackPrompt",
        label: "Step-Back Prompt",
        description:
          "Custom prompt template for generating the step-back question. Leave empty to use the built-in default.",
        type: "string",
        default: "",
        advanced: true,
      },
    ],
    defaults: { includeOriginal: true, stepBackPrompt: "" },
  },
  {
    id: "rewrite",
    name: "Rewrite",
    description:
      "Uses an LLM to rewrite the user query for better retrieval performance. Fixes typos, expands abbreviations, and improves query specificity.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "rewritePrompt",
        label: "Rewrite Prompt",
        description:
          "Custom prompt template for query rewriting. Leave empty to use the built-in default.",
        type: "string",
        default: "",
        advanced: true,
      },
    ],
    defaults: { rewritePrompt: "" },
  },
] as const;
