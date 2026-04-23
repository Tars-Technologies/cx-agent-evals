/**
 * Parsing helpers for LLM judge responses. Pure functions — no "use node",
 * no AI SDK imports — safe to test directly.
 */

function extractVerdict(parsed: unknown): {
  verdict: "pass" | "fail";
  reasoning: string;
} | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const answer = String(p.answer ?? p.verdict ?? "").toLowerCase().trim();
  const reasoning = String(p.reasoning ?? p.explanation ?? p.reason ?? "");
  if (answer === "pass" || answer === "yes") return { verdict: "pass", reasoning };
  if (answer === "fail" || answer === "no") return { verdict: "fail", reasoning };
  return null;
}

/**
 * Parse a judge's response into a pass/fail verdict and reasoning.
 *
 * Strategy:
 *   1. Strict JSON parse of the whole response
 *   2. Extract the first JSON object that has an answer/verdict field
 *      (handles responses wrapped in markdown code fences or prose)
 *   3. Throw — refuse to guess.
 *
 * The previous fallback (content.toLowerCase().includes("pass")) mislabeled
 * refusals like "I cannot pass judgment" as a pass. Throwing lets the caller
 * catch and mark the trace as failed rather than silently recording a wrong
 * verdict.
 */
export function parseJudgeResponse(content: string): {
  verdict: "pass" | "fail";
  reasoning: string;
} {
  try {
    const extracted = extractVerdict(JSON.parse(content));
    if (extracted) return extracted;
  } catch {
    // fall through to fragment extraction
  }

  const match = content.match(
    /\{[\s\S]*?"(?:answer|verdict)"[\s\S]*?\}/,
  );
  if (match) {
    try {
      const extracted = extractVerdict(JSON.parse(match[0]));
      if (extracted) return extracted;
    } catch {
      // fall through
    }
  }

  throw new Error(
    `Unparseable judge response: ${content.slice(0, 300)}`,
  );
}
