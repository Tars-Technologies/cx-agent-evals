import { defineSchema } from "convex/server"
import { agentTables } from "./schemas/agent.schema"
import { kbTables } from "./schemas/kb.schema"
import { sharedTables } from "./schemas/shared.schema"

export default defineSchema({
  ...kbTables,
  ...agentTables,
  ...sharedTables
})
