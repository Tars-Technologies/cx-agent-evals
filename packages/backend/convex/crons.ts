import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Retry failed LangSmith syncs every hour.
 * Finds datasets/experiments with "failed:*" sync status and retries.
 */
crons.interval(
  "retry failed langsmith syncs",
  { hours: 1 },
  internal.langsmith.syncRetry.retryFailed,
);

export default crons;
