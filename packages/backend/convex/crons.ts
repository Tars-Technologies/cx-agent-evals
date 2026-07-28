import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

/**
 * Reap orphaned Tarser parse jobs: documents stuck in parseStatus:"parsing" with
 * no callback activity. They depend on a remote callback that may never arrive
 * (lost callback, HMAC reject, abandoned job).
 */
crons.interval(
  "reap stale parsing documents",
  { minutes: 15 },
  internal.kb.documents.reapStaleParsing
)

/**
 * Reap orphaned Tarser crawls: crawl jobs stuck running/pending with no callback
 * activity. They depend on a remote callback that may never arrive (lost
 * callback, HMAC reject, abandoned job).
 */
crons.interval(
  "reap stale tarser crawls",
  { minutes: 15 },
  internal.kb.crawl.reapStaleCrawls
)

/**
 * Reap expired Tarser callback nonces: replay-protection records only matter
 * while their signature timestamp is inside the accepted window, so prune rows
 * past the retention period to keep the table bounded.
 */
crons.interval(
  "reap stale tarser callback nonces",
  { hours: 1 },
  internal.kb.tarser_nonce.reapStaleNonces
)

export default crons
