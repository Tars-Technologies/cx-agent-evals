import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(workpool, { name: "indexingPool" });
app.use(workpool, { name: "generationPool" });
app.use(workpool, { name: "experimentPool" });
app.use(agent);

export default app;
