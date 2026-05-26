import { mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import { computeBasicStats } from "./basic-stats.js"
import { parseCLIArgs, parseCSV } from "./csv-parser.js"

async function main() {
  const { input, output } = parseCLIArgs(process.argv)

  console.error(`[stats] Reading CSV: ${input}`)
  const stats = await computeBasicStats(parseCSV(input))
  stats.source = basename(input)

  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(stats, null, 2))
  console.error(`[stats] Written to: ${output}`)
  console.error(
    `[stats] ${stats.totalConversations} conversations, ${stats.uniqueVisitors} visitors, ${stats.uniqueAgents} agents`
  )
}

main().catch((err) => {
  console.error("[stats] Error:", err)
  process.exit(1)
})
