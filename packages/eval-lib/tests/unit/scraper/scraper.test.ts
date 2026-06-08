import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContentScraper } from "../../../src/scraper/scraper.js"

const mockHtml =
  "<html><body><h1>Test Page</h1><p>Content</p><a href='/other'>Link</a></body></html>"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockHtml),
      status: 200,
      headers: new Headers({ "content-type": "text/html" })
    })
  )
})

describe("ContentScraper", () => {
  it("scrapes a URL and returns markdown + metadata", async () => {
    const scraper = new ContentScraper()
    const result = await scraper.scrape("https://example.com/page")
    expect(result.url).toBe("https://example.com/page")
    expect(result.markdown).toContain("Test Page")
    expect(result.metadata.statusCode).toBe(200)
    expect(result.metadata.links).toBeInstanceOf(Array)
  })
})

describe("ContentScraper SSRF + size guards", () => {
  it("rejects scraping a blocked host before fetching", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const { ContentScraper } = await import("../../../src/scraper/scraper.js")
    await expect(
      new ContentScraper().scrape("http://169.254.169.254/")
    ).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an oversized response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/big",
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(50 * 1024 * 1024)
        }),
        text: () => Promise.resolve("x")
      })
    )
    const { ContentScraper } = await import("../../../src/scraper/scraper.js")
    await expect(
      new ContentScraper().scrape("https://example.com/big")
    ).rejects.toThrow(/too large/i)
  })

  it("rejects a non-text content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/x.bin",
        headers: new Headers({ "content-type": "application/octet-stream" }),
        text: () => Promise.resolve("x")
      })
    )
    const { ContentScraper } = await import("../../../src/scraper/scraper.js")
    await expect(
      new ContentScraper().scrape("https://example.com/x.bin")
    ).rejects.toThrow(/content-type/i)
  })
})
