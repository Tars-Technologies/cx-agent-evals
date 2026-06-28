/**
 * Dependency-light BM25 sparse encoder. eval-lib owns the keyword
 * representation (control plane): the BM25 term-frequency weighting and its
 * `k1`/`b` knobs are baked into the *document* values at encode time, while the
 * *query* contributes value `1` per term and Qdrant applies inverse document
 * frequency server-side (`modifier: "idf"`). Together the stored doc value and
 * the server IDF reproduce a BM25 dot product:
 *
 *   score(q, d) = Σ_t∈q  idf(t) · tf_d(t)·(k1+1) / (tf_d(t) + k1·(1 - b + b·|d|/avgdl))
 *
 * There is no global vocabulary to maintain: each token maps to a uint32 index
 * via a stable hash, so encoding a document needs no corpus state and two
 * processes encode identically. Hash collisions are negligible and, when they
 * do occur, are aggregated into one term (kept valid for Qdrant, which requires
 * unique sparse indices).
 *
 * The defaults match eval-lib's MiniSearch-backed `BM25SearchIndex`
 * (`k1 = 1.2`, `b = 0.75`) so a `k1`/`b` config means the same thing whether
 * keyword search runs over the sparse vector or the in-memory fallback.
 */

/** Term-frequency saturation, matching `BM25SearchIndex` (MiniSearch). */
export const DEFAULT_BM25_K1 = 1.2
/** Document-length normalization, matching `BM25SearchIndex` (MiniSearch). */
export const DEFAULT_BM25_B = 0.75
/**
 * Fixed average document length (in tokens) used for length normalization.
 * The sparse encoder has no live corpus stats at encode time, so it assumes a
 * constant `avgdl` rather than tracking it. Set `b = 0` to drop length
 * normalization entirely (then `avgdl` is irrelevant).
 */
export const DEFAULT_BM25_AVGDL = 256

/** A sparse vector in Qdrant's `{ indices, values }` shape. Indices are uint32. */
export interface SparseVector {
  readonly indices: number[]
  readonly values: number[]
}

export interface Bm25DocParams {
  readonly k1?: number
  readonly b?: number
  readonly avgdl?: number
}

/**
 * Tokenize text the same way for documents and queries: lowercase, then split
 * on any run of non-alphanumeric characters (Unicode letters/numbers kept).
 * Sharing one tokenizer is what guarantees a query term lands on the same
 * sparse index as the document term it should match.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
}

/**
 * Stable 32-bit hash (FNV-1a). Deterministic across processes and runs, so the
 * same token always maps to the same sparse index without a shared vocabulary.
 * Returns an unsigned 32-bit integer (Qdrant sparse indices are u32).
 */
export function stableHash(token: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    // 32-bit FNV prime multiply (imul keeps it in 32-bit space).
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Encode a document into a sparse BM25 vector. Each unique token index carries
 * its BM25 term-frequency weight (the `idf(t)` factor is applied later by
 * Qdrant). Tokens that collide on the same index are summed at the
 * term-frequency level before weighting, keeping indices unique.
 */
export function encodeDocument(
  content: string,
  params: Bm25DocParams = {}
): SparseVector {
  const k1 = params.k1 ?? DEFAULT_BM25_K1
  const b = params.b ?? DEFAULT_BM25_B
  const avgdl = params.avgdl ?? DEFAULT_BM25_AVGDL

  const tokens = tokenize(content)
  const length = tokens.length
  if (length === 0) return { indices: [], values: [] }

  const tfByIndex = new Map<number, number>()
  for (const token of tokens) {
    const index = stableHash(token)
    tfByIndex.set(index, (tfByIndex.get(index) ?? 0) + 1)
  }

  // BM25 length-normalization denominator term, constant across this doc.
  const norm = k1 * (1 - b + (b * length) / avgdl)

  const indices: number[] = []
  const values: number[] = []
  for (const [index, tf] of tfByIndex) {
    indices.push(index)
    values.push((tf * (k1 + 1)) / (tf + norm))
  }
  return { indices, values }
}

/**
 * Encode a query into a sparse vector with value `1` per unique term. IDF is
 * applied server-side by Qdrant's `modifier: "idf"`, so the query carries no
 * weights of its own. Uses the same tokenizer as {@link encodeDocument}.
 */
export function encodeQuery(query: string): SparseVector {
  const tokens = tokenize(query)
  const indices: number[] = []
  const values: number[] = []
  const seen = new Set<number>()
  for (const token of tokens) {
    const index = stableHash(token)
    if (seen.has(index)) continue
    seen.add(index)
    indices.push(index)
    values.push(1)
  }
  return { indices, values }
}
