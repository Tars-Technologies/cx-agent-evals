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
