export interface SearchResult {
  docId: string;
  docTitle: string;
  /** Character offset in document where match starts */
  matchStart: number;
  /** Character offset where match ends */
  matchEnd: number;
  /** Snippet of text around the match */
  snippet: string;
  /** Relevance score (higher = better) */
  score: number;
}

/**
 * Simple client-side fuzzy search across multiple documents.
 * Splits query into tokens, finds substring matches, ranks by token coverage.
 */
export function searchDocuments(
  query: string,
  documents: { docId: string; title: string; content: string }[],
  maxResults = 20,
): SearchResult[] {
  if (!query.trim()) return [];

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];

  for (const doc of documents) {
    const contentLower = doc.content.toLowerCase();

    // Find all positions where any token matches
    for (const token of tokens) {
      let searchFrom = 0;
      while (searchFrom < contentLower.length) {
        const idx = contentLower.indexOf(token, searchFrom);
        if (idx === -1) break;

        // Score: longer matches score higher, earlier matches score slightly higher
        const score = token.length * 10 - idx * 0.001;

        // Build snippet: 60 chars before, match, 60 chars after
        const snippetStart = Math.max(0, idx - 60);
        const snippetEnd = Math.min(doc.content.length, idx + token.length + 60);
        const snippet = doc.content.slice(snippetStart, snippetEnd);

        results.push({
          docId: doc.docId,
          docTitle: doc.title,
          matchStart: idx,
          matchEnd: idx + token.length,
          snippet,
          score,
        });

        searchFrom = idx + 1;
      }
    }
  }

  // Sort by score descending, deduplicate overlapping matches in same doc
  results.sort((a, b) => b.score - a.score);

  // Deduplicate: skip results that overlap with a higher-scored result in the same doc
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const overlaps = deduped.some(
      (d) =>
        d.docId === r.docId &&
        d.matchStart < r.matchEnd &&
        r.matchStart < d.matchEnd,
    );
    if (!overlaps) {
      deduped.push(r);
    }
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}
