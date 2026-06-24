import workpool from "@convex-dev/workpool/convex.config"
import { defineApp } from "convex/server"

const app = defineApp()
app.use(workpool, { name: "indexingPool" })
app.use(workpool, { name: "generationPool" })
app.use(workpool, { name: "experimentPool" })
app.use(workpool, { name: "scrapingPool" })
app.use(workpool, { name: "agentExperimentPool" })
app.use(workpool, { name: "livechatAnalysisPool" })
app.use(workpool, { name: "conversationSimPool" })
app.use(workpool, { name: "imageProcessingPool" })

export default app
