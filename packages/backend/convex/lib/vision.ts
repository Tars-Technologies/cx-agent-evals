"use node"

import { createHash } from "node:crypto"
import { normalizeUrl } from "@tars-inc/eval-lib/scraper/link-extractor"

/**
 * Deterministic image ID: stable across re-index so saved answers keep
 * resolving. Space separator avoids kbId/url concatenation collisions.
 */
export function imageIdFor(kbId: string, url: string): string {
  const hash = createHash("sha256")
    .update(`${kbId} ${normalizeUrl(url)}`)
    .digest("hex")
  return `img_${hash.slice(0, 16)}`
}

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
