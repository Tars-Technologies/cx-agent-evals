import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

/**
 * Retry failed LangSmith syncs every hour.
 * Finds datasets/experiments with "failed:*" sync status and retries.
 */
crons.interval(
  "retry failed langsmith syncs",
  { hours: 1 },
  internal.langsmith.syncRetry.retryFailed
)

/**
 * Reap orphaned Tarser jobs: documents stuck in parseStatus:"parsing" and crawl
 * jobs stuck running/pending with no callback activity. Both depend on a remote
 * callback that may never arrive (lost callback, HMAC reject, abandoned job).
 */
crons.interval(
  "reap stale parsing documents",
  { minutes: 15 },
  internal.kb.documents.reapStaleParsing
)

crons.interval(
  "reap stale tarser crawls",
  { minutes: 15 },
  internal.kb.crawl.reapStaleCrawls
)

export default crons
