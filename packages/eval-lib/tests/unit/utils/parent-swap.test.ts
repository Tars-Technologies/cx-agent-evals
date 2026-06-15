import { describe, expect, it } from "vitest"
import { parentSwap } from "../../../src/utils/parent-swap.js"

// Minimal child/parent shapes for exercising the pure algorithm. The real
// callers (native Convex rows, Qdrant ScoredChunks) map their own shapes onto
// these accessors; the algorithm itself only cares about parent-id identity,
// first-seen score, dedup, and parent-missing fallback.
type Child = { id: string; parentId?: string; score: number }
type Parent = { id: string }
type Result = { id: string; score: number; swapped: boolean }

function run(children: Child[], parents: Parent[]): Result[] {
  const parentMap = new Map(parents.map((p) => [p.id, p]))
  return parentSwap<Child, Parent, Result>(children, {
    getParentId: (c) => c.parentId,
    getParent: (parentId) => parentMap.get(parentId),
    fromParent: (parent, child) => ({
      id: parent.id,
      score: child.score,
      swapped: true
    }),
    keepChild: (child) => ({ id: child.id, score: child.score, swapped: false })
  })
}

describe("parentSwap", () => {
  it("swaps a child for its parent, keeping the child's score", () => {
    const out = run([{ id: "c1", parentId: "p1", score: 0.9 }], [{ id: "p1" }])
    expect(out).toEqual([{ id: "p1", score: 0.9, swapped: true }])
  })

  it("keeps the child when it has no parent id", () => {
    const out = run([{ id: "c1", score: 0.5 }], [])
    expect(out).toEqual([{ id: "c1", score: 0.5, swapped: false }])
  })

  it("falls back to the child when the parent row is missing", () => {
    const out = run(
      [{ id: "c1", parentId: "p-missing", score: 0.7 }],
      [] // parent not found
    )
    expect(out).toEqual([{ id: "c1", score: 0.7, swapped: false }])
  })

  it("dedupes multiple children of the same parent, keeping first-seen score", () => {
    const out = run(
      [
        { id: "c1", parentId: "p1", score: 0.9 },
        { id: "c2", parentId: "p1", score: 0.4 }
      ],
      [{ id: "p1" }]
    )
    // Only the first child's parent is emitted; the second is dropped.
    expect(out).toEqual([{ id: "p1", score: 0.9, swapped: true }])
  })

  it("preserves order and mixes swapped, kept, and deduped children", () => {
    const out = run(
      [
        { id: "c1", parentId: "p1", score: 0.9 }, // swap -> p1
        { id: "c2", score: 0.8 }, // no parent -> keep
        { id: "c3", parentId: "p1", score: 0.7 }, // dup parent -> drop
        { id: "c4", parentId: "p2", score: 0.6 } // swap -> p2
      ],
      [{ id: "p1" }, { id: "p2" }]
    )
    expect(out).toEqual([
      { id: "p1", score: 0.9, swapped: true },
      { id: "c2", score: 0.8, swapped: false },
      { id: "p2", score: 0.6, swapped: true }
    ])
  })
})
