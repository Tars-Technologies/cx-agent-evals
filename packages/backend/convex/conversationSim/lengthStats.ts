export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("median: cannot compute on empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function p90(values: number[]): number {
  if (values.length === 0) {
    throw new Error("p90: cannot compute on empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(values.length * 0.9) - 1);
  return sorted[idx];
}
