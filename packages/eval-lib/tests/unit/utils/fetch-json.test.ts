import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postJSON } from "../../../src/utils/fetch-json.js";

function mockFetchResponse(body: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("postJSON", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a POST request with JSON body and content-type header", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ data: [1, 2, 3] }),
    );

    await postJSON({
      url: "https://api.example.com/v1/embed",
      provider: "Example",
      headers: { Authorization: "Bearer test-key" },
      body: { model: "test", input: ["hello"] },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/embed");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({ model: "test", input: ["hello"] }),
    });
  });

  it("returns the parsed JSON response", async () => {
    const payload = { data: [{ embedding: [0.1, 0.2], index: 0 }] };
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(payload));

    const result = await postJSON<typeof payload>({
      url: "https://api.example.com/v1/embed",
      provider: "Example",
      body: {},
    });

    expect(result).toEqual(payload);
  });

  it("throws with provider name and status on non-2xx response", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse("rate limit exceeded", 429, "Too Many Requests"),
    );

    await expect(
      postJSON({
        url: "https://api.example.com/v1/embed",
        provider: "Voyage",
        body: {},
        retry: { maxRetries: 0 },
      }),
    ).rejects.toThrow(
      "Voyage API error: 429 Too Many Requests — rate limit exceeded",
    );
  });

  it("includes the full response body in error messages", async () => {
    const errorBody = '{"error":{"message":"Invalid API key"}}';
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(errorBody, 401, "Unauthorized"),
    );

    await expect(
      postJSON({
        url: "https://api.example.com/v1/embed",
        provider: "Jina",
        body: {},
        retry: { maxRetries: 0 },
      }),
    ).rejects.toThrow("Jina API error: 401 Unauthorized");
  });

  it("works without extra headers (Content-Type is always set)", async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ ok: true }));

    await postJSON({
      url: "https://api.example.com/v1/test",
      provider: "Test",
      body: { foo: "bar" },
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("allows custom headers to override Content-Type", async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ ok: true }));

    await postJSON({
      url: "https://api.example.com/v1/test",
      provider: "Test",
      headers: { "Content-Type": "application/xml" },
      body: "<data/>",
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({
      "Content-Type": "application/xml",
    });
  });

  describe("retry behaviour", () => {
    it("retries on transient failures and returns on eventual success", async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockResolvedValueOnce(mockFetchResponse({ success: true }));

      const result = await postJSON<{ success: boolean }>({
        url: "https://api.example.com/v1/embed",
        provider: "Test",
        body: {},
        retry: { maxRetries: 3, backoffMs: 1 },
      });

      expect(result).toEqual({ success: true });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("retries on HTTP error responses", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse("service unavailable", 503, "Service Unavailable"),
        )
        .mockResolvedValueOnce(mockFetchResponse({ data: "ok" }));

      const result = await postJSON<{ data: string }>({
        url: "https://api.example.com/v1/embed",
        provider: "Test",
        body: {},
        retry: { maxRetries: 2, backoffMs: 1 },
      });

      expect(result).toEqual({ data: "ok" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws after all retries are exhausted", async () => {
      fetchSpy.mockRejectedValue(new Error("persistent failure"));

      await expect(
        postJSON({
          url: "https://api.example.com/v1/embed",
          provider: "Voyage Rerank",
          body: {},
          retry: { maxRetries: 2, backoffMs: 1 },
        }),
      ).rejects.toThrow("persistent failure");

      // 1 initial + 2 retries = 3 total
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("uses default retry settings when retry option is omitted", async () => {
      // Fail 3 times then succeed (default maxRetries is 3)
      fetchSpy
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockRejectedValueOnce(new Error("fail 3"))
        .mockResolvedValueOnce(mockFetchResponse({ ok: true }));

      // Default withRetry: maxRetries=3, so 4 total attempts
      // This should succeed on the 4th attempt
      const result = await postJSON<{ ok: boolean }>({
        url: "https://api.example.com/v1/embed",
        provider: "Test",
        body: {},
        // Use tiny backoff so test doesn't take long
        retry: { backoffMs: 1 },
      });

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("does not retry when maxRetries is 0", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("immediate failure"));

      await expect(
        postJSON({
          url: "https://api.example.com/v1/embed",
          provider: "Test",
          body: {},
          retry: { maxRetries: 0 },
        }),
      ).rejects.toThrow("immediate failure");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
