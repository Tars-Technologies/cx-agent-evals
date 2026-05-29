import { defineSchema } from "convex/server"
import { kbTables } from "./schemas/kb.schema"
import { agentTables } from "./schemas/agent.schema"

export default defineSchema({
  ...kbTables,
  ...agentTables,
})
