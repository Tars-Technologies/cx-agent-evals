import { beforeEach, describe, expect, it, vi } from "vitest"
import { PythonContentService } from "../../../src/scraper/python-content-service.js"

const cfg = {
  baseUrl: "http://tarser:8000",
  apiToken: "tok",
  hmacSecret: "sec"
}

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body))
    })
  )
}

describe("PythonContentService HTTP", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("startCrawl POSTs /jobs with Bearer auth + camelCase body and returns serviceJobId", async () => {
    mockFetchOnce({ serviceJobId: "svc-1" })
    const svc = new PythonContentService(cfg)
    const out = await svc.startCrawl({
      startUrl: "https://example.com",
      config: { maxPages: 5, crawlMode: "http" },
      callbackUrl: "https://cb?jobId=j&token=t"
    })
    expect(out).toEqual({ serviceJobId: "svc-1" })
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(url).toBe("http://tarser:8000/jobs")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer tok")
    const sent = JSON.parse(init.body)
    expect(sent).toMatchObject({
      type: "crawl",
      startUrl: "https://example.com",
      config: { maxPages: 5, crawlMode: "http" },
      callbackUrl: "https://cb?jobId=j&token=t"
    })
  })

  it("startParse POSTs /parse and returns serviceJobId", async () => {
    mockFetchOnce({ serviceJobId: "svc-2" })
    const out = await new PythonContentService(cfg).startParse({
      fileUrl: "https://x/f.pdf",
      mimeType: "application/pdf",
      options: { parserPreference: "pymupdf" },
      callbackUrl: "https://cb"
    })
    expect(out).toEqual({ serviceJobId: "svc-2" })
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("http://tarser:8000/parse")
  })

  it("cancel issues DELETE /jobs/{id}", async () => {
    mockFetchOnce({ ok: true })
    await new PythonContentService(cfg).cancel("svc-1")
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(url).toBe("http://tarser:8000/jobs/svc-1")
    expect(init.method).toBe("DELETE")
  })

  it("cancel throws on a non-2xx response", async () => {
    mockFetchOnce({ error: "nope" }, 500)
    await expect(new PythonContentService(cfg).cancel("svc-1")).rejects.toThrow(
      /cancel failed/i
    )
  })

  it("checkHealth returns false on non-200", async () => {
    mockFetchOnce({}, 503)
    expect(await new PythonContentService(cfg).checkHealth()).toBe(false)
  })

  it("throws a clear error on a non-JSON 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
        text: () => Promise.resolve("")
      })
    )
    await expect(
      new PythonContentService(cfg).startCrawl({
        startUrl: "https://example.com",
        config: { crawlMode: "http" },
        callbackUrl: "https://cb"
      })
    ).rejects.toThrow(/expected JSON/i)
  })

  it("caps an oversized error-response body instead of buffering it whole", async () => {
    // A hostile/huge control-plane response must not be read unbounded.
    const TOTAL = 200 * 1024
    const enc = new TextEncoder()
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= TOTAL) {
          controller.close()
          return
        }
        const n = Math.min(16 * 1024, TOTAL - sent)
        sent += n
        controller.enqueue(enc.encode("a".repeat(n)))
      }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, body }))
    const err = await new PythonContentService(cfg)
      .cancel("svc-1")
      .catch((e: Error) => e)
    expect((err as Error).message).toMatch(/cancel failed: HTTP 500/)
    // Body portion was capped well below the 200 KB the server streamed.
    expect((err as Error).message.length).toBeLessThan(80 * 1024)
  })

  it("caps a single oversized chunk to ~64 KB (no one-chunk overshoot)", async () => {
    const enc = new TextEncoder()
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.close()
          return
        }
        sent = true
        controller.enqueue(enc.encode("a".repeat(256 * 1024))) // one 256 KB chunk
      }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, body }))
    const err = await new PythonContentService(cfg)
      .cancel("svc-1")
      .catch((e: Error) => e)
    // The "HTTP 500 " prefix + at most a 64 KB body slice; the chunk is sliced
    // to the remaining budget before decode, so we don't keep the whole 256 KB.
    expect((err as Error).message.length).toBeLessThan(64 * 1024 + 256)
  })

  it("does not hang on zero-length chunks", async () => {
    const enc = new TextEncoder()
    let count = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (count >= 3) {
          controller.close()
          return
        }
        count++
        controller.enqueue(enc.encode("")) // empty chunk
      }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, body }))
    await expect(new PythonContentService(cfg).cancel("svc-1")).rejects.toThrow(
      /cancel failed: HTTP 500/
    )
  })

  it("passes an abort signal on outbound calls", async () => {
    mockFetchOnce({ serviceJobId: "svc-1" })
    await new PythonContentService(cfg).startCrawl({
      startUrl: "https://example.com",
      config: { crawlMode: "http" },
      callbackUrl: "https://cb"
    })
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("PythonContentService.normalizeCallback (live wire shapes)", () => {
  it("maps url_done ok -> page", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "url_done",
        service_job_id: "JID",
        url: "https://example.com/p",
        status: "ok",
        finish_reason: "finished",
        markdown: "# Hello",
        metadata: { title: "Example", depth: 0 },
        error_category: null,
        error: null,
        content_hash: "abc123"
      })
    ).toEqual({
      kind: "page",
      serviceJobId: "JID",
      url: "https://example.com/p",
      markdown: "# Hello",
      title: "Example",
      depth: 0,
      contentHash: "abc123"
    })
  })

  it("maps url_done failed -> page_failed", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "url_done",
        service_job_id: "JID",
        url: "https://x",
        status: "failed",
        finish_reason: "unknown",
        markdown: null,
        metadata: {},
        error_category: null,
        error: "boom",
        content_hash: null
      })
    ).toEqual({
      kind: "page_failed",
      serviceJobId: "JID",
      url: "https://x",
      error: "boom",
      finishReason: "unknown",
      errorCategory: undefined
    })
  })

  it("maps url_done document_file (no markdown) -> discovered_file", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "url_done",
        service_job_id: "JID",
        url: "https://x/file.pdf",
        status: "ok",
        finish_reason: "finished",
        metadata: { source_page: "https://x", kind: "document_file" }
      })
    ).toEqual({
      kind: "discovered_file",
      serviceJobId: "JID",
      fileUrl: "https://x/file.pdf",
      sourcePage: "https://x"
    })
  })

  it("maps parse_done -> parsed", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "parse_done",
        service_job_id: "JID",
        status: "ok",
        markdown: "# Doc",
        metadata: { pages: 2 },
        images: [{ page_number: 1, mime_type: "image/png" }],
        error: null,
        content_hash: "d34d"
      })
    ).toEqual({
      kind: "parsed",
      serviceJobId: "JID",
      status: "ok",
      markdown: "# Doc",
      metadata: { pages: 2 },
      error: undefined,
      contentHash: "d34d"
    })
  })

  it("maps job_complete -> job_complete", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "job_complete",
        service_job_id: "JID",
        final_stats: { visited: 3, failed: 1, skipped: 0, files: 2 },
        finish_reason: "finished"
      })
    ).toEqual({
      kind: "job_complete",
      serviceJobId: "JID",
      finishReason: "finished",
      stats: { visited: 3, failed: 1, skipped: 0, files: 2 }
    })
  })

  it("maps unknown/dead events -> ignored", () => {
    expect(
      PythonContentService.normalizeCallback({
        event: "discovered_batch",
        service_job_id: "JID",
        pages: []
      })
    ).toEqual({ kind: "ignored", event: "discovered_batch" })
  })
})
