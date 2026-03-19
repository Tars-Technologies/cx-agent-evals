import type { RegistryEntry } from "./types.js";

export const CHUNKER_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "recursive-character",
    name: "Recursive Character",
    description:
      "Splits text by recursively trying separators (paragraphs, sentences, words) until chunks fit under the size limit. The most versatile general-purpose chunker.",
    status: "available",
    tags: ["general-purpose", "fast"],
    options: [
      {
        key: "chunkSize",
        label: "Chunk Size",
        description:
          "Maximum number of characters per chunk. Larger chunks retain more context but reduce retrieval precision.",
        type: "number",
        default: 1000,
        constraints: { min: 100, max: 10000, step: 100 },
      },
      {
        key: "chunkOverlap",
        label: "Chunk Overlap",
        description:
          "Number of characters to overlap between consecutive chunks. Overlap helps preserve context at chunk boundaries.",
        type: "number",
        default: 200,
        constraints: { min: 0, max: 5000, step: 50 },
      },
      {
        key: "separators",
        label: "Separators",
        description:
          "Custom separator characters to try in order, as a comma-separated list. Leave empty to use the default hierarchy (double newline, newline, space).",
        type: "string",
        default: "",
        advanced: true,
      },
    ],
    defaults: { chunkSize: 1000, chunkOverlap: 200, separators: "" },
  },
  {
    id: "sentence",
    name: "Sentence",
    description:
      "Splits text on sentence boundaries, then groups sentences until they reach the max chunk size. Preserves complete sentences for better readability.",
    status: "available",
    tags: ["natural-language"],
    options: [
      {
        key: "maxChunkSize",
        label: "Max Chunk Size",
        description:
          "Maximum number of characters per chunk. Sentences are grouped together until this limit is reached.",
        type: "number",
        default: 1000,
        constraints: { min: 100, max: 10000, step: 100 },
      },
      {
        key: "overlapSentences",
        label: "Overlap Sentences",
        description:
          "Number of sentences to repeat at the start of the next chunk for continuity.",
        type: "number",
        default: 0,
        constraints: { min: 0, max: 10, step: 1 },
      },
    ],
    defaults: { maxChunkSize: 1000, overlapSentences: 0 },
  },
  {
    id: "token",
    name: "Token",
    description:
      "Splits text by token count using a specific tokenizer encoding. Useful when you need precise control over the number of tokens per chunk.",
    status: "available",
    tags: ["token-aware"],
    options: [
      {
        key: "maxTokens",
        label: "Max Tokens",
        description:
          "Maximum number of tokens per chunk. Aligns chunk boundaries with model context limits.",
        type: "number",
        default: 256,
        constraints: { min: 32, max: 4096, step: 32 },
      },
      {
        key: "overlapTokens",
        label: "Overlap Tokens",
        description:
          "Number of tokens to overlap between consecutive chunks for boundary context.",
        type: "number",
        default: 0,
        constraints: { min: 0, max: 256, step: 8 },
      },
      {
        key: "encoding",
        label: "Encoding",
        description:
          "Tokenizer encoding to use. cl100k_base is the standard for GPT-4 and text-embedding-3 models.",
        type: "select",
        choices: [
          {
            value: "cl100k_base",
            label: "cl100k_base",
            description: "GPT-4 / text-embedding-3 tokenizer",
          },
          {
            value: "p50k_base",
            label: "p50k_base",
            description: "GPT-3 / Codex tokenizer",
          },
        ],
        default: "cl100k_base",
        advanced: true,
      },
    ],
    defaults: { maxTokens: 256, overlapTokens: 0, encoding: "cl100k_base" },
  },
  {
    id: "markdown",
    name: "Markdown",
    description:
      "Splits markdown documents by header hierarchy, preserving document structure. Best for documentation, READMEs, and structured knowledge bases.",
    status: "available",
    tags: ["structured"],
    options: [
      {
        key: "maxChunkSize",
        label: "Max Chunk Size",
        description:
          "Maximum number of characters per chunk. Sections exceeding this limit are split further.",
        type: "number",
        default: 1000,
        constraints: { min: 100, max: 10000, step: 100 },
      },
      {
        key: "headerLevels",
        label: "Header Levels",
        description:
          "Comma-separated list of header levels to split on (e.g., '1,2,3'). Higher levels create finer-grained chunks.",
        type: "string",
        default: "1,2,3",
        advanced: true,
      },
      {
        key: "mergeSmallSections",
        label: "Merge Small Sections",
        description:
          "When enabled, adjacent sections that are individually below the chunk size limit are merged into a single chunk.",
        type: "boolean",
        default: true,
        advanced: true,
      },
    ],
    defaults: {
      maxChunkSize: 1000,
      headerLevels: "1,2,3",
      mergeSmallSections: true,
    },
  },
  {
    id: "semantic",
    name: "Semantic",
    description:
      "Uses embeddings to detect topic shifts and splits at semantic boundaries. Produces semantically coherent chunks at the cost of requiring an embedder.",
    status: "available",
    tags: ["async", "requires-embedder"],
    options: [
      {
        key: "percentileThreshold",
        label: "Percentile Threshold",
        description:
          "Percentile of embedding distance used as the split threshold. Higher values mean fewer, larger chunks.",
        type: "number",
        default: 95,
        constraints: { min: 50, max: 100, step: 5 },
      },
      {
        key: "maxChunkSize",
        label: "Max Chunk Size",
        description:
          "Hard upper limit on chunk size in characters. Chunks exceeding this are force-split even without a semantic boundary.",
        type: "number",
        default: 2000,
        constraints: { min: 200, max: 10000, step: 100 },
      },
    ],
    defaults: { percentileThreshold: 95, maxChunkSize: 2000 },
  },
  {
    id: "cluster-semantic",
    name: "Cluster Semantic",
    description:
      "Embeds small segments then clusters them to form topic-coherent chunks. Good when documents mix multiple topics without clear structural separators.",
    status: "available",
    tags: ["async", "requires-embedder"],
    options: [
      {
        key: "maxChunkSize",
        label: "Max Chunk Size",
        description:
          "Maximum number of characters per output chunk after clustering.",
        type: "number",
        default: 400,
        constraints: { min: 100, max: 5000, step: 50 },
      },
      {
        key: "segmentSize",
        label: "Segment Size",
        description:
          "Number of characters per initial micro-segment before clustering. Smaller segments give finer-grained topic detection.",
        type: "number",
        default: 50,
        constraints: { min: 10, max: 500, step: 10 },
      },
    ],
    defaults: { maxChunkSize: 400, segmentSize: 50 },
  },
  {
    id: "llm-semantic",
    name: "LLM Semantic",
    description:
      "Uses an LLM to identify natural topic boundaries in text. Produces the most semantically meaningful chunks but is the slowest and most expensive approach.",
    status: "available",
    tags: ["async", "requires-llm"],
    options: [
      {
        key: "segmentSize",
        label: "Segment Size",
        description:
          "Number of characters per segment sent to the LLM for boundary detection.",
        type: "number",
        default: 50,
        constraints: { min: 10, max: 500, step: 10 },
      },
      {
        key: "batchSize",
        label: "Batch Size",
        description:
          "Number of characters to send per LLM call. Larger batches reduce API calls but may hit context limits.",
        type: "number",
        default: 800,
        constraints: { min: 100, max: 5000, step: 100 },
      },
    ],
    defaults: { segmentSize: 50, batchSize: 800 },
  },
] as const;
