import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "indexingPool" });
app.use(workpool, { name: "generationPool" });
app.use(workpool, { name: "experimentPool" });
app.use(workpool, { name: "scrapingPool" });

export default app;
