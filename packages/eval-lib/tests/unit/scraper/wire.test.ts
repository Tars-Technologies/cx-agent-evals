import { describe, expect, it } from "vitest"
import { ErrorCategory, FinishReason } from "../../../src/scraper/wire.js"

describe("wire enums", () => {
  it("FinishReason mirrors Tarser values exactly", () => {
    expect(Object.values(FinishReason).sort()).toEqual(
      [
        "cancelled",
        "closespider_pagecount",
        "finished",
        "not_supported",
        "site_failure",
        "skipped",
        "timeout",
        "unknown"
      ].sort()
    )
  })

  it("ErrorCategory mirrors Tarser values exactly", () => {
    expect(Object.values(ErrorCategory).sort()).toEqual(
      ["404", "cloudflare", "login", "network", "other", "parse_error", "timeout"].sort()
    )
  })
})
