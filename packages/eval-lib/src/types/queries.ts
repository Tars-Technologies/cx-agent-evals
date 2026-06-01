import type { QueryId, QueryText } from "./primitives.js"

export interface Query {
  readonly id: QueryId
  readonly text: QueryText
  readonly metadata: Readonly<Record<string, unknown>>
}
