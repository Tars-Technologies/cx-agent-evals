/**
 * Parse newline-separated query variants from LLM output.
 * Strips numbering prefixes (e.g. "1.", "1)", "- ") and empty lines.
 */
export function parseVariants(text: string, expectedCount: number): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|-\s*)/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, expectedCount);
}
