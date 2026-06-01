import { defineTable } from "convex/server"
import { type Infer, v } from "convex/values"

export const userValidator = v.object({
  clerkId: v.string(),
  email: v.string(),
  name: v.string(),
  createdAt: v.number()
})
export type User = Infer<typeof userValidator>

export const sharedTables = {
  users: defineTable(userValidator).index("by_clerk_id", ["clerkId"])
}
