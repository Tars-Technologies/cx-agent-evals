/**
 * Shared instruction text for the LLM that generates `behaviorAnchors`
 * during scenario generation AND during the migration backfill.
 *
 * Keeping this in one place ensures that both code paths produce
 * comparable anchors.
 */
export const BEHAVIOR_ANCHORS_INSTRUCTION = `Produce 3-6 short bullet phrases capturing how this specific user spoke. Each bullet must be ≤12 words. Examples:
  - "Answers questions with a single word"
  - "Switches to Arabic when frustrated"
  - "Splits questions across multiple short messages"
  - "Doesn't volunteer information until asked"

Extract observable patterns from the transcript or exemplars provided, not generic persona traits. Output only a JSON array of strings: ["bullet 1", "bullet 2", ...]. No prose, no markdown.`;
