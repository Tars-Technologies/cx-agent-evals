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
Some retrieved results include an image menu: each entry has an \`imageId\` and \`alt\` text, and the chunk text shows where the image sits as \`![alt](imageId)\`.

To show an image to the user:
1. Call the \`get_images\` tool with the imageIds you want (you may request up to ${MAX_IMAGES_PER_TURN}).
2. After it returns, write \`![alt](imageId)\` exactly where you want each image to appear in your answer, using only imageIds the tool returned.

Rules:
- Only reference imageIds that appeared in retrieved results and that \`get_images\` returned. Never invent image IDs or URLs.
- Only include an image when it directly illustrates the answer. After calling \`get_images\`, look at what each image actually depicts and skip any that don't clearly help — never include decorative icons, logos, flags, location pins/dots, charts you can't read, or images unrelated to the question.
- Prefer including no image over including a marginally-relevant one.
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
