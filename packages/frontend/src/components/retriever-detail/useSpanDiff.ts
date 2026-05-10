import type { SpanLite } from "./types";

export type RetrievedWithRank = SpanLite & { rank: number };

export type DiffRow = {
  gold: SpanLite[];
  retrieved: RetrievedWithRank[];
};

function overlaps(a: SpanLite, b: SpanLite): boolean {
  return a.docId === b.docId && a.start < b.end && b.start < a.end;
}

/**
 * Group gold and retrieved spans into rows by transitive overlap.
 *
 * A gold span and a retrieved span end up in the same row iff there's a chain
 * of overlap connecting them. Result handles many-to-many: a retrieved chunk
 * covering N gold spans (or vice versa) becomes one row with N+1 cards.
 *
 * Rows are sorted by (docId, earliest start) so the diff reads top-to-bottom
 * in source order. Spans with no counterpart appear in solo rows.
 */
export function buildDiffRows(
  goldSpans: SpanLite[],
  retrievedSpans: SpanLite[],
): DiffRow[] {
  const retrieved: RetrievedWithRank[] = retrievedSpans.map((s, i) => ({
    ...s,
    rank: i + 1,
  }));

  const totalNodes = goldSpans.length + retrieved.length;
  const parent = Array.from({ length: totalNodes }, (_, i) => i);

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (parent[cur] !== root) {
      const next = parent[cur]!;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };

  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Connect any gold ↔ retrieved that overlap directly. Transitivity comes
  // for free through union-find.
  for (let i = 0; i < goldSpans.length; i++) {
    for (let j = 0; j < retrieved.length; j++) {
      if (overlaps(goldSpans[i]!, retrieved[j]!)) {
        union(i, goldSpans.length + j);
      }
    }
  }

  const groups = new Map<number, DiffRow>();

  for (let i = 0; i < goldSpans.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { gold: [], retrieved: [] });
    groups.get(root)!.gold.push(goldSpans[i]!);
  }
  for (let j = 0; j < retrieved.length; j++) {
    const root = find(goldSpans.length + j);
    if (!groups.has(root)) groups.set(root, { gold: [], retrieved: [] });
    groups.get(root)!.retrieved.push(retrieved[j]!);
  }

  const earliestStart = (row: DiffRow): { docId: string; start: number } => {
    let best: { docId: string; start: number } | null = null;
    for (const s of [...row.gold, ...row.retrieved]) {
      if (!best || s.docId < best.docId || (s.docId === best.docId && s.start < best.start)) {
        best = { docId: s.docId, start: s.start };
      }
    }
    return best ?? { docId: "", start: 0 };
  };

  return Array.from(groups.values()).sort((a, b) => {
    const ea = earliestStart(a);
    const eb = earliestStart(b);
    if (ea.docId !== eb.docId) return ea.docId.localeCompare(eb.docId);
    return ea.start - eb.start;
  });
}
