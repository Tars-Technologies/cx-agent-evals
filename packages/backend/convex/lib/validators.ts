import { v } from "convex/values"

export const spanValidator = v.object({
  docId: v.string(),
  start: v.number(),
  end: v.number(),
  text: v.string()
})

/** The finite set of vector-store backends an index/retriever may use. */
export const vectorBackendValidator = v.union(
  v.literal("native"),
  v.literal("qdrant")
)
