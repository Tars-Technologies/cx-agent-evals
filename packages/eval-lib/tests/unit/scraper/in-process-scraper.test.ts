import { beforeEach, describe, expect, it, vi } from "vitest"
import { InProcessScraper } from "../../../src/scraper/in-process-scraper.js"
import { NotSupportedError } from "../../../src/scraper/ports.js"

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

describe("InProcessScraper", () => {
  it("scrapePage returns ScrapedPage markdown + metadata (parity with ContentScraper)", async () => {
    const scraper = new InProcessScraper()
    const page = await scraper.scrapePage("https://example.com/page")
    expect(scraper.name).toBe("inprocess")
    expect(page.url).toBe("https://example.com/page")
    expect(page.markdown).toContain("Test Page")
    expect(page.metadata.statusCode).toBe(200)
  })

  it("checkHealth resolves true", async () => {
    expect(await new InProcessScraper().checkHealth()).toBe(true)
  })

  it("startCrawl throws NotSupportedError (Convex owns the in-process frontier)", async () => {
    await expect(
      new InProcessScraper().startCrawl({
        startUrl: "https://x",
        config: {},
        callbackUrl: "https://cb"
      })
    ).rejects.toBeInstanceOf(NotSupportedError)
  })
})
