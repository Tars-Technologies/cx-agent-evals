import { describe, it, expect, vi } from "vitest";
import { ContentScraper } from "../../../src/scraper/scraper.js";

// Mock got-scraping to avoid real HTTP calls
vi.mock("got-scraping", () => ({
  gotScraping: vi.fn(),
}));

describe("ContentScraper", () => {
  it("should scrape a URL and return markdown + metadata", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockResolvedValueOnce({
      body: `<html><head><title>Test Page</title></head>
        <body><article><h1>Hello</h1><p>World content here with enough text.</p>
        <a href="https://example.com/other">Link</a></article></body></html>`,
      statusCode: 200,
    } as any);

    const scraper = new ContentScraper();
    const result = await scraper.scrape("https://example.com/page");

    expect(result.url).toBe("https://example.com/page");
    expect(result.markdown).toContain("Hello");
    expect(result.markdown).toContain("World");
    expect(result.metadata.title).toBe("Test Page");
    expect(result.metadata.sourceURL).toBe("https://example.com/page");
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.links).toContain("https://example.com/other");
  });

  it("should pass custom headers to got-scraping", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockResolvedValueOnce({
      body: "<html><head><title>T</title></head><body><p>Ok</p></body></html>",
      statusCode: 200,
    } as any);

    const scraper = new ContentScraper({
      defaultHeaders: { "X-Custom": "test" },
    });
    await scraper.scrape("https://example.com", {
      headers: { Authorization: "Bearer xyz" },
    });

    expect(mockGot).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Custom": "test",
          Authorization: "Bearer xyz",
        }),
      }),
    );
  });

  it("should throw on HTTP errors", async () => {
    const { gotScraping } = await import("got-scraping");
    const mockGot = vi.mocked(gotScraping);

    mockGot.mockRejectedValueOnce(new Error("Request failed: 404"));

    const scraper = new ContentScraper();
    await expect(scraper.scrape("https://example.com/missing")).rejects.toThrow();
  });
});
