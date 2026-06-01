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
})
