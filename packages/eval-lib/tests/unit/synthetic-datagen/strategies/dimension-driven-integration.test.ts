import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DimensionDrivenStrategy } from "../../../../src/synthetic-datagen/strategies/dimension-driven/generator.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";
import { createDocument, createCorpus } from "../../../../src/types/documents.js";

let tmpDir: string;

describe("DimensionDrivenStrategy integration", () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dd-integration-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should run the full pipeline: load dims → filter → relevance → sample → generate", async () => {
    const dimsPath = join(tmpDir, "dims.json");

    await writeFile(
      dimsPath,
      JSON.stringify({
        dimensions: [
          {
            name: "Persona",
            description: "User type",
            values: ["developer", "admin"],
          },
          {
            name: "Intent",
            description: "What they want",
            values: ["how_to", "troubleshooting"],
          },
        ],
      }),
    );

    const corpus = createCorpus([
      createDocument({
        id: "setup.md",
        content: "This guide covers setting up the authentication system with OAuth2.",
      }),
    ]);

    let callCount = 0;
    const llm: LLMClient = {
      name: "MockLLM",
      async complete(params) {
        callCount++;
        const content = params.messages.map((m) => m.content).join(" ");

        // Call 1: pairwise filtering (1 pair for 2 dimensions)
        if (content.includes("unrealistic")) {
          return JSON.stringify({ unrealistic_pairs: [] });
        }

        // Call 2: doc summary
        if (content.includes("Summarize")) {
          return JSON.stringify({ summary: "Auth setup guide for developers" });
        }

        // Call 3: combo-doc assignment
        if (content.includes("Assign")) {
          return JSON.stringify({
            assignments: [
              { doc_id: "setup.md", combo_index: 0 },
              { doc_id: "setup.md", combo_index: 1 },
            ],
          });
        }

        // Remaining calls: batch question generation per document
        return JSON.stringify({
          questions: [
            { profile_index: 0, question: "How do I configure OAuth2 for my app?" },
            { profile_index: 1, question: "How do I configure OAuth2 for my app?" },
          ],
        });
      },
    };

    const strategy = new DimensionDrivenStrategy({
      dimensionsFilePath: dimsPath,
      totalQuestions: 2,
    });

    const results = await strategy.generate({
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].targetDocId).toBe("setup.md");
    expect(results[0].metadata.strategy).toBe("dimension-driven");
    expect(results[0].query).toBe("How do I configure OAuth2 for my app?");

  });
});
