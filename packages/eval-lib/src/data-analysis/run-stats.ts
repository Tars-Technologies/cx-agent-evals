import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseCSV, parseCLIArgs } from "./csv-parser.js";
import { computeBasicStats } from "./basic-stats.js";

async function main() {
  const { input, output } = parseCLIArgs(process.argv);

  console.error(`[stats] Reading CSV: ${input}`);
  const stats = await computeBasicStats(parseCSV(input));
  stats.source = basename(input);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(stats, null, 2));
  console.error(`[stats] Written to: ${output}`);
  console.error(`[stats] ${stats.totalConversations} conversations, ${stats.uniqueVisitors} visitors, ${stats.uniqueAgents} agents`);
}

main().catch((err) => {
  console.error("[stats] Error:", err);
  process.exit(1);
});
