import { describe, expect, it } from "vitest"
import { assertPublicHttpUrl, isBlockedHost } from "../../../src/scraper/url-guard.js"

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local, metadata, and 0.0.0.0", () => {
    for (const h of [
      "localhost", "127.0.0.1", "0.0.0.0", "10.0.0.5", "172.16.0.1",
      "172.31.255.255", "192.168.1.1", "169.254.169.254", "[::1]", "::1"
    ]) {
      expect(isBlockedHost(h)).toBe(true)
    }
  })
  it("allows public hosts", () => {
    for (const h of ["example.com", "docs.example.com", "8.8.8.8"]) {
      expect(isBlockedHost(h)).toBe(false)
    }
  })
})

describe("assertPublicHttpUrl", () => {
  it("accepts http/https public URLs", () => {
    expect(() => assertPublicHttpUrl("https://example.com/docs")).not.toThrow()
    expect(() => assertPublicHttpUrl("http://example.com")).not.toThrow()
  })
  it("rejects non-http(s) schemes", () => {
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow()
    expect(() => assertPublicHttpUrl("ftp://example.com")).toThrow()
    expect(() => assertPublicHttpUrl("gopher://x")).toThrow()
  })
  it("rejects private/loopback/metadata hosts", () => {
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow()
    expect(() => assertPublicHttpUrl("http://localhost:8000")).toThrow()
    expect(() => assertPublicHttpUrl("http://10.0.0.1")).toThrow()
  })
})
