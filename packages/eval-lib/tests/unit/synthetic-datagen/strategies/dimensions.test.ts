import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDimensions } from "../../../../src/synthetic-datagen/strategies/dimension-driven/dimensions.js";
import { discoverDimensions } from "../../../../src/synthetic-datagen/strategies/dimension-driven/discovery.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dimensions-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadDimensions", () => {
  it("should load and validate a valid dimensions file", async () => {
    const filePath = join(tmpDir, "valid.json");
    await writeFile(
      filePath,
      JSON.stringify({
        dimensions: [
          {
            name: "User Persona",
            description: "Who is asking",
            values: ["new_user", "admin"],
          },
        ],
      }),
    );

    const dims = await loadDimensions(filePath);
    expect(dims).toHaveLength(1);
    expect(dims[0].name).toBe("User Persona");
    expect(dims[0].values).toEqual(["new_user", "admin"]);

    await rm(filePath);
  });

  it("should reject a dimensions file with < 2 values", async () => {
    const filePath = join(tmpDir, "invalid.json");
    await writeFile(
      filePath,
      JSON.stringify({
        dimensions: [
          { name: "X", description: "Y", values: ["only_one"] },
        ],
      }),
    );

    await expect(loadDimensions(filePath)).rejects.toThrow();
    await rm(filePath);
  });
});

describe("discoverDimensions", () => {
  it("should fetch website, call LLM, and write dimensions file", async () => {
    const outputPath = join(tmpDir, "discovered.json");
    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({
          dimensions: [
            {
              name: "Intent",
              description: "What the user wants",
              values: ["troubleshooting", "how_to"],
            },
          ],
        });
      },
    };

    const dims = await discoverDimensions({
      url: "https://example.com",
      outputPath,
      llmClient: llm,
      model: "gpt-4o",
      fetchPage: async () =>
        '<html><body><h1>Example Product</h1><a href="/docs">Docs</a></body></html>',
    });

    expect(dims).toHaveLength(1);
    expect(dims[0].name).toBe("Intent");

    // Verify file was written
    const loaded = await loadDimensions(outputPath);
    expect(loaded).toEqual(dims);

    await rm(outputPath);
  });
});
