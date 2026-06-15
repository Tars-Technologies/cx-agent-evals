/**
 * Pure parent-child swap algorithm shared by the native (Convex) and external
 * (Qdrant) retrieval paths. Both replace a retrieved child chunk with its
 * parent chunk, keeping the first-seen child's score, deduping repeated parents,
 * and falling back to the child when the parent row is missing.
 *
 * Callers differ only in data shape (flat Convex rows vs Qdrant ScoredChunks),
 * so they supply accessors/builders; the dedup + first-seen + fallback logic
 * lives here once so the two paths cannot drift.
 */
export interface ParentSwapOps<TChild, TParent, TResult> {
  /** Parent id declared by a child, or undefined if the child has no parent. */
  getParentId: (child: TChild) => string | undefined
  /** Resolve a parent by id, or undefined if it was not found. */
  getParent: (parentId: string) => TParent | undefined
  /** Build the result row from the resolved parent and the swapped child. */
  fromParent: (parent: TParent, child: TChild) => TResult
  /** Build the result row from the child (no parent / parent missing). */
  keepChild: (child: TChild) => TResult
}

export function parentSwap<TChild, TParent, TResult>(
  children: readonly TChild[],
  ops: ParentSwapOps<TChild, TParent, TResult>
): TResult[] {
  const seen = new Set<string>()
  const out: TResult[] = []
  for (const child of children) {
    const parentId = ops.getParentId(child)
    if (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = ops.getParent(parentId)
      out.push(parent ? ops.fromParent(parent, child) : ops.keepChild(child))
    } else if (!parentId) {
      out.push(ops.keepChild(child))
    }
    // A child whose parent was already emitted is dropped (dedup).
  }
  return out
}
