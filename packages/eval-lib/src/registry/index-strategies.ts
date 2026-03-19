import type { RegistryEntry } from "./types.js";

export const INDEX_STRATEGY_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "plain",
    name: "Plain",
    description:
      "Standard direct-index approach: chunks are embedded and stored as-is. No additional LLM processing during indexing. Fast, simple, and the recommended starting point.",
    status: "available",
    options: [],
    defaults: {},
  },
  {
    id: "contextual",
    name: "Contextual",
    description:
      "Prepends LLM-generated context to each chunk before embedding, improving retrieval by capturing broader document context. Increases indexing time and cost.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "contextPrompt",
        label: "Context Prompt",
        description:
          "Custom prompt template for generating chunk context. Leave empty to use the built-in default prompt.",
        type: "string",
        default: "",
        advanced: true,
      },
      {
        key: "concurrency",
        label: "Concurrency",
        description:
          "Number of concurrent LLM calls for context generation. Higher values speed up indexing but increase rate-limit risk.",
        type: "number",
        default: 5,
        constraints: { min: 1, max: 20, step: 1 },
        advanced: true,
      },
    ],
    defaults: { contextPrompt: "", concurrency: 5 },
  },
  {
    id: "summary",
    name: "Summary",
    description:
      "Generates an LLM summary for each chunk and indexes both the summary embedding and the original text. Helps match high-level queries to specific content.",
    status: "available",
    tags: ["requires-llm"],
    options: [
      {
        key: "summaryPrompt",
        label: "Summary Prompt",
        description:
          "Custom prompt template for generating chunk summaries. Leave empty to use the built-in default prompt.",
        type: "string",
        default: "",
        advanced: true,
      },
      {
        key: "concurrency",
        label: "Concurrency",
        description:
          "Number of concurrent LLM calls for summary generation. Higher values speed up indexing but increase rate-limit risk.",
        type: "number",
        default: 5,
        constraints: { min: 1, max: 20, step: 1 },
        advanced: true,
      },
    ],
    defaults: { summaryPrompt: "", concurrency: 5 },
  },
  {
    id: "parent-child",
    name: "Parent-Child",
    description:
      "Creates two levels of chunks: small child chunks for precise retrieval and larger parent chunks for context. Returns parent chunks when child chunks match.",
    status: "available",
    options: [
      {
        key: "childChunkSize",
        label: "Child Chunk Size",
        description:
          "Character size of the small child chunks used for retrieval matching.",
        type: "number",
        default: 200,
        constraints: { min: 50, max: 2000, step: 50 },
      },
      {
        key: "parentChunkSize",
        label: "Parent Chunk Size",
        description:
          "Character size of the larger parent chunks returned as context.",
        type: "number",
        default: 1000,
        constraints: { min: 200, max: 10000, step: 100 },
      },
      {
        key: "childOverlap",
        label: "Child Overlap",
        description:
          "Character overlap between consecutive child chunks.",
        type: "number",
        default: 0,
        constraints: { min: 0, max: 500, step: 10 },
      },
      {
        key: "parentOverlap",
        label: "Parent Overlap",
        description:
          "Character overlap between consecutive parent chunks.",
        type: "number",
        default: 100,
        constraints: { min: 0, max: 2000, step: 50 },
      },
    ],
    defaults: {
      childChunkSize: 200,
      parentChunkSize: 1000,
      childOverlap: 0,
      parentOverlap: 100,
    },
  },
] as const;
