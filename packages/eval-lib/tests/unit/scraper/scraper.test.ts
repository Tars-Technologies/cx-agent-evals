import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  assertHostResolvesPublic,
  ContentScraper
} from "../../../src/scraper/scraper.js"

const mockHtml =
  "<html><body><h1>Test Page</h1><p>Content</p><a href='/other'>Link</a></body></html>"

// Resolver stub returning a public IP so tests never hit real DNS.
const publicDns = async () => ["93.184.216.34"]

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
    const scraper = new ContentScraper({ dnsLookup: publicDns })
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
    await expect(
      new ContentScraper({ dnsLookup: publicDns }).scrape(
        "http://169.254.169.254/"
      )
    ).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects a host that resolves to a private IP (DNS rebinding)", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    await expect(
      new ContentScraper({
        dnsLookup: async () => ["10.0.0.5"]
      }).scrape("https://internal.example.com/")
    ).rejects.toThrow(/private\/loopback\/metadata/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an oversized response body (declared Content-Length)", async () => {
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
    await expect(
      new ContentScraper({ dnsLookup: publicDns }).scrape(
        "https://example.com/big"
      )
    ).rejects.toThrow(/too large/i)
  })

  it("aborts a streamed body that exceeds the byte cap", async () => {
    // Emit 2 MB chunks forever; the 10 MB cap must abort the read.
    const chunk = new Uint8Array(2 * 1024 * 1024)
    const body = {
      getReader() {
        return {
          read: async () => ({ done: false, value: chunk }),
          cancel: async () => {}
        }
      }
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        url: "https://example.com/stream",
        headers: new Headers({ "content-type": "text/html" }),
        body
      })
    )
    await expect(
      new ContentScraper({ dnsLookup: publicDns }).scrape(
        "https://example.com/stream"
      )
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
    await expect(
      new ContentScraper({ dnsLookup: publicDns }).scrape(
        "https://example.com/x.bin"
      )
    ).rejects.toThrow(/content-type/i)
  })

  it("rejects a non-2xx response instead of storing error HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 404,
        url: "https://example.com/missing",
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve("<html><body>Not Found</body></html>")
      })
    )
    await expect(
      new ContentScraper({ dnsLookup: publicDns }).scrape(
        "https://example.com/missing"
      )
    ).rejects.toThrow(/status 404/i)
  })
})

describe("assertHostResolvesPublic", () => {
  it("rejects a host that resolves to a private/metadata IP", async () => {
    await expect(
      assertHostResolvesPublic("evil.example.com", async () => [
        "169.254.169.254"
      ])
    ).rejects.toThrow(/private\/loopback\/metadata/i)
  })
  it("allows a host that resolves only to public IPs", async () => {
    await expect(
      assertHostResolvesPublic("good.example.com", async () => [
        "93.184.216.34"
      ])
    ).resolves.toBeUndefined()
  })
  it("rejects when DNS resolution fails", async () => {
    await expect(
      assertHostResolvesPublic("nx.example.com", async () => {
        throw new Error("ENOTFOUND")
      })
    ).rejects.toThrow(/DNS resolution failed/i)
  })
})
