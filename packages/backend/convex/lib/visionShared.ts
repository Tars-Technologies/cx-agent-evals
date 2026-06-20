/**
 * Pure vision helpers — no Node-only deps, importable from mutations, queries,
 * the pure promptTemplate, and tests. The node-only pieces (imageIdFor,
 * buildGetImagesTool) live in `vision.ts`, which re-exports everything here.
 */

import { rewriteMarkdownImages } from "@tars-inc/eval-lib/file-processing/markdown-images"

export const MAX_IMAGES_PER_TURN = 4

// Explicit allowlist — resolveModel routes by id but has no vision check.
export const VISION_CAPABLE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo"
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
- Only include an image when it genuinely helps answer the question.
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
