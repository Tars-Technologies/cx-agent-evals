import type { DimensionCombo, DocComboAssignment } from "../types.js"

export function stratifiedSample(
  assignments: readonly DocComboAssignment[],
  totalQuestions: number
): DocComboAssignment[] {
  if (assignments.length === 0) return []
  if (totalQuestions >= assignments.length) return [...assignments]

  const selected: DocComboAssignment[] = []
  const usedIndices = new Set<number>()

  // Phase 1: Ensure every document is represented at least once
  const docIndices = new Map<string, number[]>()
  for (let i = 0; i < assignments.length; i++) {
    const docId = assignments[i].docId
    if (!docIndices.has(docId)) docIndices.set(docId, [])
    docIndices.get(docId)!.push(i)
  }

  for (const indices of docIndices.values()) {
    if (selected.length >= totalQuestions) break
    const idx = indices[Math.floor(Math.random() * indices.length)]
    selected.push(assignments[idx])
    usedIndices.add(idx)
  }

  // Phase 2: Ensure combo coverage (each unique combo at least once)
  const comboKey = (c: DimensionCombo) =>
    Object.entries(c)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("|")

  const coveredCombos = new Set<string>()
  for (const a of selected) coveredCombos.add(comboKey(a.combo))

  for (
    let i = 0;
    i < assignments.length && selected.length < totalQuestions;
    i++
  ) {
    const key = comboKey(assignments[i].combo)
    if (!coveredCombos.has(key) && !usedIndices.has(i)) {
      selected.push(assignments[i])
      usedIndices.add(i)
      coveredCombos.add(key)
    }
  }

  // Phase 3: Fill remaining budget proportionally across documents
  const docCounts = new Map<string, number>()
  for (const a of selected) {
    docCounts.set(a.docId, (docCounts.get(a.docId) ?? 0) + 1)
  }

  const remaining = [...assignments.entries()]
    .filter(([i]) => !usedIndices.has(i))
    .map(([i]) => i)

  // Sort remaining by document that has fewest selections (balance)
  remaining.sort((a, b) => {
    const countA = docCounts.get(assignments[a].docId) ?? 0
    const countB = docCounts.get(assignments[b].docId) ?? 0
    return countA - countB
  })

  for (const idx of remaining) {
    if (selected.length >= totalQuestions) break
    selected.push(assignments[idx])
    const docId = assignments[idx].docId
    docCounts.set(docId, (docCounts.get(docId) ?? 0) + 1)
  }

  return selected
}
