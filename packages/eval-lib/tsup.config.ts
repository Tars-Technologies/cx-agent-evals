import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/embedders/openai.ts",
    "src/embedders/make-embedder.ts",
    "src/rerankers/cohere.ts",
    "src/rerankers/make-reranker.ts",
    "src/embedders/cohere.ts",
    "src/embedders/voyage.ts",
    "src/embedders/jina.ts",
    "src/rerankers/jina.ts",
    "src/rerankers/voyage.ts",
    "src/pipeline/internals.ts",
    "src/pipeline/llm-openai.ts",
    "src/utils/index.ts",
    "src/utils/parent-swap.ts",
    "src/langsmith/index.ts",
    "src/llm/index.ts",
    "src/shared/index.ts",
    "src/file-processing/index.ts",
    "src/file-processing/markdown-images.ts",
    "src/scraper/index.ts",
    "src/scraper/link-extractor.ts",
    "src/registry/index.ts",
    "src/data-analysis/index.ts",
    "src/multimodal/index.ts"
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: [
    "openai",
    "langsmith",
    "langsmith/evaluation",
    "@langchain/core",
    "@mozilla/readability",
    "linkedom",
    "turndown",
    "unpdf",
    "@anthropic-ai/sdk",
    "csv-parse"
  ]
})
