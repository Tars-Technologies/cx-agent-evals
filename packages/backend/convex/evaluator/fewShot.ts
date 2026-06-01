import { stratifiedFewShot } from "./splits";

export type FewShotExample = {
  label: "pass" | "fail";
  messages: { role: string; content: string }[];
};

const MAX_MESSAGES_PER_EXAMPLE = 16;

/** Pure: render selected examples into a prompt block. Returns "" when empty. */
export function renderFewShotBlock(examples: FewShotExample[]): string {
  if (examples.length === 0) return "";
  return examples
    .map((ex, i) => {
      const lines = ex.messages
        .slice(0, MAX_MESSAGES_PER_EXAMPLE)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      const truncated =
        ex.messages.length > MAX_MESSAGES_PER_EXAMPLE ? "\n…(truncated)" : "";
      return `### Example ${i + 1}\n${lines}${truncated}\nVerdict: ${ex.label}`;
    })
    .join("\n\n");
}

/**
 * Pure: choose a balanced set of train-label ids for few-shot.
 * Wraps `stratifiedFewShot` so call sites only deal with ids.
 */
export function selectFewShot(
  passIds: string[],
  failIds: string[],
  targetCount: number,
  seed: number,
): string[] {
  return stratifiedFewShot(passIds, failIds, targetCount, seed).ids;
}
