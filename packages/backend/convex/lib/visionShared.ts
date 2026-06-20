/**
 * Pure vision helpers — no Node-only deps, importable from mutations, queries,
 * the pure promptTemplate, and tests. The node-only pieces (imageIdFor,
 * buildGetImagesTool) live in `vision.ts`, which re-exports everything here.
 */

import { rewriteMarkdownImages } from "@tars-inc/eval-lib/file-processing/markdown-images"

export const MAX_IMAGES_PER_TURN = 4

// Explicit allowlist — resolveModel routes by id but has no vision check.
// Must track the model menu in AgentConfigPanel.tsx: every selectable model
// here is vision-capable, so the toggle works regardless of which one is
// picked. Add new model ids here when the dropdown gains them.
export const VISION_CAPABLE_MODELS = [
  // Claude (Anthropic) — all 4.x are multimodal
  "claude-opus-4-8",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  // OpenAI — 4.1 family, 4o family, and o-series are multimodal
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "o3",
  "o4-mini"
]

export function isVisionCapable(modelId: string): boolean {
  return VISION_CAPABLE_MODELS.includes(modelId)
}

/** Appended to the system prompt only when hasVision (V6). */
export const IMAGE_INSTRUCTIONS = `# Images
Some retrieved results include an image menu: each entry has an \`imageId\` and \`alt\` text, and the chunk text shows where the image sits as \`![alt](imageId)\`. Every real imageId begins with \`img_\` (e.g. \`img_3f9a2c1b4d5e6f70\`).

When the retrieved results include an image relevant to your answer (a screenshot, diagram, photo, UI, map, or chart), you SHOULD show it — default to including a clearly relevant image rather than leaving it out.

To show an image to the user:
1. Call the \`get_images\` tool, passing imageIds copied EXACTLY from the retrieved image menu (you may request up to ${MAX_IMAGES_PER_TURN}).
2. After it returns, write \`![alt](imageId)\` exactly where you want each image to appear in your answer, using only imageIds the tool actually returned.

Rules:
- ONLY pass imageIds that literally appear in the retrieved results (they start with \`img_\`). Copy them character-for-character. NEVER invent, guess, abbreviate, or reformat an imageId or URL.
- If the retrieved results contain NO image menu, do not call \`get_images\` and do not include any image — just answer in text. An empty \`get_images\` result means the id did not exist; never retry with a made-up id.
- If a retrieved image is on-topic, include it — a relevant screenshot or diagram makes the answer much more useful. After calling \`get_images\`, look at what each image actually depicts and skip any that don't clearly help — never include decorative icons, logos, flags, location pins/dots, charts you can't read, or images unrelated to the question.
- When in doubt about a clearly on-topic image, include it; only skip images that are off-topic or decorative.
- Do not write raw external image URLs; use the imageId form only.`

export interface ImageMenuEntry {
  imageId: string
  alt: string
}

/** Flatten metadata.images across retrieved chunks, dedup by imageId. */
export function buildImageMenuFromChunks(
  chunks: Array<{
    metadata?: { images?: Array<{ imageId: string; alt: string }> }
  }>
): ImageMenuEntry[] {
  const seen = new Set<string>()
  const out: ImageMenuEntry[] = []
  for (const c of chunks) {
    for (const img of c.metadata?.images ?? []) {
      if (seen.has(img.imageId)) continue
      seen.add(img.imageId)
      out.push({ imageId: img.imageId, alt: img.alt })
    }
  }
  return out
}

/**
 * Finalize guard (V4/V9): keep only images whose target is a resolved imageId,
 * rewriting them to the real URL. Everything else (hallucinated ids, raw
 * external urls the model may have written) is removed. Authoritative
 * regardless of KB content.
 */
export function whitelistImageMarkdown(
  text: string,
  resolved: Map<string, { url: string; alt: string }>
): string {
  return rewriteMarkdownImages(text, ({ url }) => {
    // `url` here is whatever the model wrote in (...) — an imageId or a real url.
    const hit = resolved.get(url)
    return hit ? hit.url : null
  })
}
