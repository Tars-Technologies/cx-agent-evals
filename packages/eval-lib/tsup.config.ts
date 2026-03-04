import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/embedders/openai.ts",
    "src/rerankers/cohere.ts",
    "src/pipeline/internals.ts",
    "src/utils/index.ts",
    "src/langsmith/index.ts",
    "src/llm/index.ts",
    "src/shared/index.ts",
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
    "cohere-ai",
  ],
});
