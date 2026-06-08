/**
 * SSRF guard for the in-process crawler. Allows only http/https to public hosts,
 * blocking loopback, private (RFC1918), link-local, and cloud-metadata addresses.
 * Literal-IP and hostname checks only (no DNS resolution) - pair with manual-redirect
 * re-validation in the scraper so each hop is re-checked.
 */
export function isBlockedHost(host: string): boolean {
  let h = host.trim().toLowerCase()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1) // [::1] -> ::1
  if (h === "localhost" || h.endsWith(".localhost")) return true

  // IPv6 checks only apply to actual IPv6 addresses (they contain a colon), so
  // public hostnames like "facebook.com" / "fedex.com" are not misclassified.
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true
    if (h.startsWith("fc") || h.startsWith("fd")) return true // unique-local fc00::/7
    if (h.startsWith("fe80:")) return true // link-local
  }

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b, c, d] = [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4])
    ]
    if (a > 255 || b > 255 || c > 255 || d > 255) return false // malformed octet
    if (a === 0 || a === 127) return true // 0.0.0.0/8, loopback
    if (a === 10) return true // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
    if (a === 192 && b === 168) return true // 192.168/16
    if (a === 169 && b === 254) return true // link-local + metadata
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10 (RFC 6598)
    if (a >= 224) return true // multicast / reserved
  }
  return false
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${url.protocol}`)
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(`Blocked host (private/loopback/metadata): ${url.hostname}`)
  }
  return url
}
