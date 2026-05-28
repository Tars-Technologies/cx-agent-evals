import type { CharacterSpan } from "./chunks.js"

export interface EvaluationResult {
  readonly metrics: Readonly<Record<string, number>>
  readonly experimentUrl?: string
  readonly rawResults?: unknown
}

export interface RunOutput {
  readonly relevantSpans: readonly CharacterSpan[]
}
