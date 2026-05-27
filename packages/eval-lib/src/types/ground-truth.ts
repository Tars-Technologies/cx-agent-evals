import { z } from "zod"
import type { CharacterSpan } from "./chunks.js"
import type { Query } from "./queries.js"

export interface GroundTruth {
  readonly query: Query
  readonly relevantSpans: readonly CharacterSpan[]
}

export const DatasetExampleSchema = z.object({
  inputs: z.object({ query: z.string() }),
  outputs: z.object({
    relevantSpans: z.array(
      z.object({
        docId: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        text: z.string()
      })
    )
  }),
  metadata: z.record(z.unknown()).default({})
})

export interface DatasetExample {
  readonly inputs: { readonly query: string }
  readonly outputs: {
    readonly relevantSpans: ReadonlyArray<{
      readonly docId: string
      readonly start: number
      readonly end: number
      readonly text: string
    }>
  }
  readonly metadata: Readonly<Record<string, unknown>>
}
