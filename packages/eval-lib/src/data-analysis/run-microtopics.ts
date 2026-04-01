import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseCLIArgs } from "./csv-parser.js";
import { createClaudeClient } from "./claude-client.js";
import { extractMicrotopics } from "./microtopic-extractor.js";
import type { RawTranscriptsFile } from "./types.js";

async function main() {
  const { input, output, limit, concurrency } = parseCLIArgs(process.argv);

  console.error(`[microtopics] Reading raw transcripts: ${input}`);
  const rawFile: RawTranscriptsFile = JSON.parse(readFileSync(input, "utf-8"));

  console.error(
    `[microtopics] ${rawFile.totalConversations} total conversations, processing ${limit ?? "all"}`
  );

  const client = createClaudeClient();
  const result = await extractMicrotopics(rawFile.conversations, {
    claudeClient: client,
    source: rawFile.source,
    limit,
    concurrency: concurrency ?? 10,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.error(
    `[microtopics] Written ${result.processedConversations} conversations to: ${output}`
  );
  if (result.failures.length > 0) {
    console.error(
      `[microtopics] ${result.failures.length} failures: ${result.failures.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error("[microtopics] Error:", err);
  process.exit(1);
});
