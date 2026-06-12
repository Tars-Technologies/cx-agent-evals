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
  it("blocks NAT64, 6to4, site-local, multicast, and expanded IPv4-mapped IPv6", () => {
    for (const h of [
      "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
      "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254 (cloud metadata)
      "2002:7f00:1::", // 6to4 wrapping loopback
      "fec0::1", // deprecated site-local
      "ff02::1", // multicast
      "ff01::1", // multicast
      "0:0:0:0:0:ffff:7f00:1" // expanded IPv4-mapped loopback
    ]) {
      expect(isBlockedHost(h)).toBe(true)
    }
  })
  it("blocks decimal/octal/hex/short IPv4 encodings of loopback", () => {
    // URL parsing normalizes these before they reach isBlockedHost; assert the
    // canonical loopback forms they resolve to are blocked.
    for (const raw of [
      "http://2130706433", // decimal 127.0.0.1
      "http://0x7f000001", // hex 127.0.0.1
      "http://0177.0.0.1", // octal first octet
      "http://127.1" // short form 127.0.0.1
    ]) {
      const host = new URL(raw).hostname
      expect(isBlockedHost(host)).toBe(true)
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
