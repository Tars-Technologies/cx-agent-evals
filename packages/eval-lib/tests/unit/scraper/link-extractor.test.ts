import { describe, expect, it } from "vitest"
import {
  filterLinks,
  normalizeUrl
} from "../../../src/scraper/link-extractor.js"

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page"
    )
  })
  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe(
      "https://example.com/page"
    )
  })
  it("lowercases host", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Page")).toBe(
      "https://example.com/Page"
    )
  })
  it("sorts query params", () => {
    expect(normalizeUrl("https://example.com?b=2&a=1")).toBe(
      "https://example.com/?a=1&b=2"
    )
  })
  it("gives a bare host and its trailing-slash form the same key", () => {
    // Crawl dedup relies on this: a seed URL and a discovered link to the home
    // page must normalize identically or the home page re-scrapes as a duplicate.
    expect(normalizeUrl("https://example.com")).toBe(
      normalizeUrl("https://example.com/")
    )
  })
  it("strips userinfo so credentials don't leak into the dedup key", () => {
    expect(normalizeUrl("https://user:pass@example.com/foo")).toBe(
      "https://example.com/foo"
    )
  })
})

describe("filterLinks", () => {
  const base = "https://example.com"
  const links = [
    "https://example.com/help/faq",
    "https://example.com/login",
    "https://other.com/page",
    "https://sub.example.com/page"
  ]

  it("keeps same-domain links by default", () => {
    const result = filterLinks(links, base)
    expect(result).toContain("https://example.com/help/faq")
    expect(result).not.toContain("https://other.com/page")
  })
  it("filters by includePaths", () => {
    const result = filterLinks(links, base, { includePaths: ["/help/*"] })
    expect(result).toContain("https://example.com/help/faq")
    expect(result).not.toContain("https://example.com/login")
  })
  it("filters by excludePaths", () => {
    const result = filterLinks(links, base, { excludePaths: ["/login"] })
    expect(result).not.toContain("https://example.com/login")
  })
  it("allows subdomains when configured", () => {
    const result = filterLinks(links, base, { allowSubdomains: true })
    expect(result).toContain("https://sub.example.com/page")
  })
  it("rejects look-alike domains even with subdomains allowed", () => {
    const result = filterLinks(
      ["https://evilexample.com/page", "https://sub.example.com/page"],
      base,
      { allowSubdomains: true }
    )
    expect(result).not.toContain("https://evilexample.com/page")
    expect(result).toContain("https://sub.example.com/page")
  })
  it("does not throw on a malformed glob pattern", () => {
    // One mistyped include/exclude pattern must not crash the whole crawl.
    expect(() =>
      filterLinks(["https://example.com/foo"], base, {
        includePaths: ["/foo(("]
      })
    ).not.toThrow()
  })
  it("treats '.' in a pattern as a literal, not a wildcard", () => {
    const result = filterLinks(
      ["https://example.com/api.v1/x", "https://example.com/apiXv1/x"],
      base,
      { includePaths: ["/api.v1/*"] }
    )
    expect(result).toContain("https://example.com/api.v1/x")
    expect(result).not.toContain("https://example.com/apiXv1/x")
  })
  it("does not hang on a ReDoS-style globstar pattern", () => {
    // `/**********x` would compile to `^\/.*.*...x$` and catastrophically
    // backtrack against non-matching paths. The guard/collapse must keep this
    // well under a millisecond rather than hanging the crawl WorkPool.
    const start = performance.now()
    expect(() =>
      filterLinks(["https://example.com/aaaaaaaaaaaaaaaaaaaaaaaa"], base, {
        includePaths: ["/**********x"]
      })
    ).not.toThrow()
    expect(performance.now() - start).toBeLessThan(50)
  })
  it("still matches normal '**' and '*' globs correctly", () => {
    const docs = filterLinks(
      ["https://example.com/docs/intro", "https://example.com/blog/post"],
      base,
      { includePaths: ["/docs/**"] }
    )
    expect(docs).toContain("https://example.com/docs/intro")
    expect(docs).not.toContain("https://example.com/blog/post")

    const blog = filterLinks(
      ["https://example.com/blog/post", "https://example.com/blog/a/b"],
      base,
      { includePaths: ["/blog/*"] }
    )
    expect(blog).toContain("https://example.com/blog/post")
    // single `*` stays within one segment
    expect(blog).not.toContain("https://example.com/blog/a/b")
  })
})
