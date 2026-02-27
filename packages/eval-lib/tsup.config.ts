import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/embedders/openai.ts",
    "src/vector-stores/chroma.ts",
    "src/rerankers/cohere.ts",
    "src/langsmith/index.ts",
    "src/langsmith/experiment-runner.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
});
