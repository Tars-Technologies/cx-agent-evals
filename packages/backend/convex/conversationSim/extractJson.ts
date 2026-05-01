/**
 * Robust JSON extraction from LLM output. Handles:
 * - Plain JSON
 * - Markdown-fenced JSON (```json ... ```)
 * - JSON arrays/objects with surrounding prose
 * - Lazy match preferred (avoids capturing trailing content), falls back to greedy
 *
 * Used by both scenario-generation and migration code paths.
 */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const arrayMatch = stripped.match(/\[[\s\S]*?\](?=\s*$)/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
    }
    const objMatch = stripped.match(/\{[\s\S]*?\}(?=\s*$)/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
    const greedyArray = stripped.match(/\[[\s\S]*\]/);
    if (greedyArray) {
      try { return JSON.parse(greedyArray[0]); } catch { /* fall through */ }
    }
    const greedyObj = stripped.match(/\{[\s\S]*\}/);
    if (greedyObj) {
      try { return JSON.parse(greedyObj[0]); } catch { /* fall through */ }
    }
    throw new Error(`Failed to parse LLM response as JSON: ${stripped.slice(0, 200)}`);
  }
}
