import { describe, expect, it } from "vitest"
import {
  assertPublicHttpUrl,
  isBlockedHost
} from "../../../src/scraper/url-guard.js"

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local, metadata, and 0.0.0.0", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.255",
      "[::1]",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "[::ffff:127.0.0.1]",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1"
    ]) {
      expect(isBlockedHost(h)).toBe(true)
    }
  })
  it("allows public hosts, incl. names starting with IPv6-like prefixes", () => {
    for (const h of [
      "example.com",
      "docs.example.com",
      "8.8.8.8",
      "99.64.0.1", // not CGNAT (first octet 99)
      "facebook.com", // starts with "fc" but not IPv6
      "fedex.com", // starts with "fd" but not IPv6
      "fe80news.com", // starts with "fe80" but not IPv6
      "999.999.999.999" // malformed octets -> not treated as a blocked IP
    ]) {
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
    expect(() =>
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")
    ).toThrow()
    expect(() => assertPublicHttpUrl("http://localhost:8000")).toThrow()
    expect(() => assertPublicHttpUrl("http://10.0.0.1")).toThrow()
  })
})
