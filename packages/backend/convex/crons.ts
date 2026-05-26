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

/**
 * Idempotent seed of built-in evaluator templates.
 * Runs daily; skips templates that already exist by name.
 */
crons.daily(
  "seed evaluator templates",
  { hourUTC: 0, minuteUTC: 0 },
  internal.evaluator.templates.seedAll,
);

export default crons;
