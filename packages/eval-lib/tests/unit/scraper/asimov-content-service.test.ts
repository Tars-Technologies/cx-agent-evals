import { beforeEach, describe, expect, it, vi } from "vitest"
import { AsimovContentService } from "../../../src/scraper/asimov-content-service.js"
import { makeParser, makeScraper } from "../../../src/scraper/factory.js"
import type {
  JobNotReadyError,
  ParserJobResult,
  ScraperJobResult
} from "../../../src/scraper/ports.js"

const cfg = {
  baseUrl: "http://asimov:8000",
  apiToken: "tok"
}

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  }
}

/** Queue a sequence of JSON responses, one per fetch() call. */
function mockFetchSequence(...responses: { body: unknown; status?: number }[]) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce(jsonResponse(r.body, r.status ?? 200))
  }
  vi.stubGlobal("fetch", fn)
  return fn as FetchMock
}

function lastCalls(): [string, RequestInit][] {
  return (fetch as unknown as FetchMock).mock.calls as [string, RequestInit][]
}

describe("AsimovContentService submit", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("startCrawl POSTs /api/data-resources with web loader, tars-3.0 mode, Bearer auth", async () => {
    mockFetchSequence({ body: { data_resource_id: "dr-1" } })
    const out = await new AsimovContentService(cfg).startCrawl({
      startUrl: "https://example.com",
      config: { maxPages: 5, maxDepth: 2 },
      callbackUrl: "ignored"
    })
    expect(out).toEqual({ serviceJobId: "dr-1" })
    const [url, init] = lastCalls()[0]
    expect(url).toBe("http://asimov:8000/api/data-resources")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    )
    const sent = JSON.parse(init.body as string)
    expect(sent.loader).toBe("web_base_loader")
    expect(sent.loader_options).toMatchObject({
      url: "https://example.com",
      mode: "tars-3.0",
      max_pages: 5,
      max_depth: 2
    })
  })

  it("startParse POSTs pdf loader with tars-3.0 mode and OCR flags only when set", async () => {
    mockFetchSequence({ body: { data_resource_id: "dr-2" } })
    const out = await new AsimovContentService(cfg).startParse({
      fileUrl: "https://x/f.pdf",
      mimeType: "application/pdf",
      options: { ocr: true, ocrProvider: "google/gemini-2.5-flash" },
      callbackUrl: "ignored"
    })
    expect(out).toEqual({ serviceJobId: "dr-2" })
    const [, init] = lastCalls()[0]
    const sent = JSON.parse(init.body as string)
    expect(sent.loader).toBe("pdf_loader")
    expect(sent.loader_options).toMatchObject({
      url: "https://x/f.pdf",
      mode: "tars-3.0",
      ocr: true,
      ocrProvider: "google/gemini-2.5-flash"
    })
    // captionImages was not set, so it must be absent.
    expect("captionImages" in sent.loader_options).toBe(false)
  })

  it("submit throws on non-2xx and on a missing data_resource_id", async () => {
    mockFetchSequence({ body: { error: "no" }, status: 500 })
    await expect(
      new AsimovContentService(cfg).startCrawl({
        startUrl: "https://x",
        config: {},
        callbackUrl: "i"
      })
    ).rejects.toThrow(/startCrawl failed: HTTP 500/)

    mockFetchSequence({ body: { wrong: "shape" } })
    await expect(
      new AsimovContentService(cfg).startParse({
        fileUrl: "https://x/f.pdf",
        mimeType: "application/pdf",
        callbackUrl: "i"
      })
    ).rejects.toThrow(/missing data_resource_id/)
  })

  it("cancel issues DELETE /api/data-resources/{id}", async () => {
    mockFetchSequence({ body: { ok: true } })
    await new AsimovContentService(cfg).cancel("dr-1")
    const [url, init] = lastCalls()[0]
    expect(url).toBe("http://asimov:8000/api/data-resources/dr-1")
    expect(init.method).toBe("DELETE")
  })

  it("cancel throws on a non-2xx response", async () => {
    mockFetchSequence({ body: { error: "nope" }, status: 500 })
    await expect(new AsimovContentService(cfg).cancel("dr-1")).rejects.toThrow(
      /cancel failed/i
    )
  })

  it("passes an abort signal on outbound calls", async () => {
    mockFetchSequence({ body: { data_resource_id: "dr-1" } })
    await new AsimovContentService(cfg).startCrawl({
      startUrl: "https://x",
      config: {},
      callbackUrl: "i"
    })
    const [, init] = lastCalls()[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("AsimovContentService getResult (poll + paginated drain)", () => {
  beforeEach(() => vi.unstubAllGlobals())

  const svc = () =>
    new AsimovContentService({
      ...cfg,
      pollIntervalMs: 1, // keep the test fast
      pollDeadlineMs: 10_000
    })

  it("polls status (PENDING/RUNNING → SUCCESS) then drains paginated crawl content following an integer next_cursor", async () => {
    const fetchMock = mockFetchSequence(
      { body: { status: "PENDING" } },
      { body: { status: "RUNNING" } },
      { body: { status: "SUCCESS" } },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          // Integer offset, as Asimov really emits.
          next_cursor: 2,
          pages: [
            {
              url: "https://example.com/a",
              markdown: "# A",
              metadata: { title: "Page A", links: ["https://example.com/b"] }
            }
          ],
          // Asimov emits `failed` as list[str] (bare URL strings).
          failed: []
        }
      },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: null,
          pages: [
            {
              url: "https://example.com/b",
              markdown: "# B",
              metadata: { title: "Page B" }
            }
          ],
          failed: ["https://example.com/c"]
        }
      }
    )

    const result = (await svc().getResult("dr-1", "crawl")) as ScraperJobResult
    expect(result.kind).toBe("crawl")
    expect(result.finishReason).toBe("finished")
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]).toEqual({
      url: "https://example.com/a",
      markdown: "# A",
      metadata: {
        title: "Page A",
        sourceURL: "https://example.com/a",
        description: undefined,
        language: undefined,
        statusCode: 200,
        links: ["https://example.com/b"]
      }
    })
    // list[str] failed entry normalizes to { url } with no error.
    expect(result.failed).toEqual([{ url: "https://example.com/c" }])

    // 3 status polls + 2 content pages = 5 calls.
    expect(fetchMock).toHaveBeenCalledTimes(5)
    // Status URL shape.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://asimov:8000/api/data-resources/dr-1/status"
    )
    // Content pages: first has no cursor, second carries the integer cursor=2.
    const contentCall1 = fetchMock.mock.calls[3][0] as string
    const contentCall2 = fetchMock.mock.calls[4][0] as string
    expect(contentCall1).toContain("/content/dr-1")
    expect(contentCall1).toContain("limit=")
    expect(contentCall1).not.toContain("cursor=")
    expect(contentCall2).toContain("cursor=2")
    // Auth header present on status + content.
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    )
  })

  it("drains all pages across a multi-page integer-cursor chain (0 → 2 → 4 → null)", async () => {
    const fetchMock = mockFetchSequence(
      { body: { status: "SUCCESS" } },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: 2,
          pages: [{ url: "https://example.com/p1", markdown: "# 1" }],
          failed: []
        }
      },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: 4,
          pages: [{ url: "https://example.com/p2", markdown: "# 2" }],
          failed: []
        }
      },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: null,
          pages: [{ url: "https://example.com/p3", markdown: "# 3" }],
          failed: []
        }
      }
    )

    const result = (await svc().getResult("dr-1", "crawl")) as ScraperJobResult
    expect(result.kind).toBe("crawl")
    // All three pages must be collected — fails if pagination stops after page 1.
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3"
    ])

    // 1 status poll + 3 content pages = 4 calls.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const c1 = fetchMock.mock.calls[1][0] as string
    const c2 = fetchMock.mock.calls[2][0] as string
    const c3 = fetchMock.mock.calls[3][0] as string
    expect(c1).not.toContain("cursor=")
    expect(c2).toContain("cursor=2")
    expect(c3).toContain("cursor=4")
  })

  it("with expectedKind 'parse', builds a ParserJobResult from the parsed doc in `pages` (PDF parse, files empty)", async () => {
    // Ground truth: a PDF parse (pdf_loader, tars-3.0) stashes the parsed
    // markdown into `pages` with content_type application/pdf, and `files: []`
    // (the content `files` is the discovered-file-URL set from crawls). Without
    // the hint, the old shape heuristic would mislabel this as kind:"crawl".
    mockFetchSequence(
      { body: { status: "SUCCESS" } },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: null,
          pages: [
            {
              url: "https://x/f.pdf",
              markdown: "# Parsed page 1",
              metadata: {
                content_type: "application/pdf",
                source: "https://x/f.pdf",
                title: "Doc"
              }
            },
            {
              url: "https://x/f.pdf",
              markdown: "## Parsed page 2",
              metadata: { content_type: "application/pdf" }
            }
          ],
          files: [],
          failed: []
        }
      }
    )
    const result = (await svc().getResult("dr-2", "parse")) as ParserJobResult
    expect(result.kind).toBe("parse")
    expect(result.status).toBe("ok")
    // All page markdown concatenated in order into a single document.
    expect(result.file?.markdown).toBe("# Parsed page 1\n\n## Parsed page 2")
    expect(result.file?.title).toBe("Doc")
  })

  it("normalizes a parse job (files-only content, no hint) into a ParserJobResult", async () => {
    mockFetchSequence(
      { body: { status: "SUCCESS" } },
      {
        body: {
          status: "SUCCESS",
          finish_reason: "finished",
          next_cursor: null,
          pages: [],
          files: [
            {
              url: "https://x/f.pdf",
              markdown: "# Parsed doc",
              metadata: { title: "Doc", pages: 3 }
            }
          ],
          failed: []
        }
      }
    )
    const result = (await svc().getResult("dr-2")) as ParserJobResult
    expect(result).toEqual({
      kind: "parse",
      status: "ok",
      file: {
        markdown: "# Parsed doc",
        title: "Doc",
        metadata: { title: "Doc", pages: 3 }
      }
    })
  })

  it("treats terminal status FAILURE as a parse failure (does not poll to deadline)", async () => {
    const fetchMock = mockFetchSequence(
      { body: { status: "FAILURE" } },
      {
        body: {
          status: "FAILURE",
          finish_reason: "site_failure",
          next_cursor: null,
          pages: [{ url: "https://x/f.pdf", markdown: "" }],
          files: [],
          // Asimov emits failed as list[str]; with no per-item error, the
          // normalizeParseResult falls back to its generic message.
          failed: ["https://x/f.pdf"]
        }
      }
    )
    const result = (await svc().getResult("dr-3", "parse")) as ParserJobResult
    expect(result).toEqual({
      kind: "parse",
      status: "failed",
      error: "Asimov returned no content"
    })
    // 1 status poll (terminal immediately) + 1 content drain = 2 calls.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("treats terminal status NOT_FOUND as terminally failed (does not poll to deadline)", async () => {
    const fetchMock = mockFetchSequence(
      { body: { status: "NOT_FOUND" } },
      {
        body: {
          status: "NOT_FOUND",
          finish_reason: "not_found",
          next_cursor: null,
          pages: [{ url: "https://x/f.pdf", markdown: "" }],
          files: [],
          failed: ["https://x/f.pdf"]
        }
      }
    )
    const result = (await svc().getResult("dr-4", "parse")) as ParserJobResult
    expect(result.kind).toBe("parse")
    expect(result).toMatchObject({ kind: "parse", status: "failed" })
    // Terminal on the first status read: no polling to deadline.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws JobNotReadyError when the job never finishes before the poll deadline", async () => {
    // Always RUNNING (non-terminal); deadline shorter than one interval forces a give-up.
    const fn = vi.fn().mockResolvedValue(jsonResponse({ status: "RUNNING" }))
    vi.stubGlobal("fetch", fn)
    const s = new AsimovContentService({
      ...cfg,
      pollIntervalMs: 1000,
      pollDeadlineMs: 1
    })
    const err = await s.getResult("dr-x").catch((e: Error) => e)
    expect((err as JobNotReadyError).name).toBe("JobNotReadyError")
    expect((err as JobNotReadyError).serviceJobId).toBe("dr-x")
    expect((err as JobNotReadyError).lastStatus).toBe("RUNNING")
  })
})

describe("getResult capability throws NotSupported on non-poll backends", () => {
  it("inprocess scraper/parser getResult throws NotSupported", async () => {
    await expect(makeScraper().getResult?.("x")).rejects.toThrow(
      /not supported/i
    )
    await expect(makeParser().getResult?.("x")).rejects.toThrow(
      /not supported/i
    )
  })

  it("tarser backend getResult throws NotSupported", async () => {
    const scraper = makeScraper({
      backend: "tarser",
      baseUrl: "http://t",
      apiToken: "t",
      hmacSecret: "s"
    })
    await expect(scraper.getResult?.("x")).rejects.toThrow(/not supported/i)
  })

  it("asimov backend exposes getResult", () => {
    const scraper = makeScraper({
      backend: "asimov",
      baseUrl: "http://a",
      apiToken: "t"
    })
    expect(typeof scraper.getResult).toBe("function")
  })
})
