/**
 * Compute a stable, ASCII-safe `docId` for a document.
 *
 * Hashes the most stable unique field available — `sourceUrl` for scraped
 * pages, `fileId` for uploaded files. The resulting 16-char hex string is
 * safe to use as a Convex object field name (which the document title is
 * not — titles may contain em-dashes, smart quotes, and other non-ASCII).
 *
 * Throws if neither seed is provided so that misuse surfaces loudly rather
 * than producing a fragile title-derived ID.
 */
export async function computeDocId(opts: {
  sourceUrl?: string
  fileId?: string
}): Promise<string> {
  const seed = opts.sourceUrl ?? opts.fileId
  if (!seed) {
    throw new Error(
      "computeDocId requires either sourceUrl or fileId — neither was provided"
    )
  }
  const bytes = new TextEncoder().encode(seed)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
