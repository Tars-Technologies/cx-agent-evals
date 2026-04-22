export function calculateQuotas(
  docs: ReadonlyArray<{ id: string; priority: number }>,
  totalQuestions: number,
  overrides?: Record<string, number>,
): Map<string, number> {
  if (overrides && Object.keys(overrides).length > 0) {
    return applyOverrides(docs, overrides, totalQuestions);
  }

  const quotas = new Map<string, number>();

  // When totalQuestions < numDocs, skip low-priority docs
  if (totalQuestions < docs.length) {
    const sorted = [...docs].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < sorted.length; i++) {
      quotas.set(sorted[i].id, i < totalQuestions ? 1 : 0);
    }
    return quotas;
  }

  // Priority-based proportional allocation
  const totalWeight = docs.reduce((s, d) => s + d.priority, 0);
  let allocated = 0;

  // Sort ascending — lowest priority first, highest last gets remainder
  const sorted = [...docs].sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    if (i === sorted.length - 1) {
      quotas.set(doc.id, totalQuestions - allocated);
    } else {
      const quota = Math.round((doc.priority / totalWeight) * totalQuestions);
      quotas.set(doc.id, quota);
      allocated += quota;
    }
  }

  return quotas;
}

function applyOverrides(
  docs: ReadonlyArray<{ id: string; priority: number }>,
  overrides: Record<string, number>,
  totalQuestions: number,
): Map<string, number> {
  const quotas = new Map<string, number>();
  let allocated = 0;

  // Sort by percentage descending — highest gets remainder
  const entries = Object.entries(overrides).sort(([, a], [, b]) => b - a);

  for (let i = 0; i < entries.length; i++) {
    const [docId, pct] = entries[i];
    if (i === entries.length - 1) {
      quotas.set(docId, totalQuestions - allocated);
    } else {
      const quota = Math.round((pct / 100) * totalQuestions);
      quotas.set(docId, quota);
      allocated += quota;
    }
  }

  // Docs without overrides get 0
  for (const doc of docs) {
    if (!quotas.has(doc.id)) quotas.set(doc.id, 0);
  }

  return quotas;
}
