/**
 * Wire vocabulary shared with the Tarser content service. These string values
 * MUST match tarser's StrEnums exactly (src/tarser/finish_reason.py).
 */
export const FinishReason = {
  Finished: "finished",
  ClosespiderPagecount: "closespider_pagecount",
  SiteFailure: "site_failure",
  Skipped: "skipped",
  NotSupported: "not_supported",
  Cancelled: "cancelled",
  Timeout: "timeout",
  Unknown: "unknown"
} as const
export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason]

export const ErrorCategory = {
  Cloudflare: "cloudflare",
  Login: "login",
  NotFound: "404",
  Timeout: "timeout",
  ParseError: "parse_error",
  Network: "network",
  Other: "other"
} as const
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory]
