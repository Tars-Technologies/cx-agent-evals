export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.hash = ""
    // Drop userinfo so `user:pass@host` and `host` dedup to one key, and
    // credentials are never persisted into crawlUrls.
    parsed.username = ""
    parsed.password = ""
    const params = new URLSearchParams(parsed.search)
    const sorted = new URLSearchParams([...params.entries()].sort())
    parsed.search = sorted.toString()
    let result = parsed.href
    if (result.endsWith("/") && parsed.pathname !== "/")
      result = result.slice(0, -1)
    if (result.endsWith("?")) result = result.slice(0, -1)
    return result
  } catch {
    return url
  }
}

export function filterLinks(
  links: string[],
  baseUrl: string,
  config?: {
    includePaths?: string[]
    excludePaths?: string[]
    allowSubdomains?: boolean
  }
): string[] {
  const baseDomain = new URL(baseUrl).hostname
  // Compile path globs once per call (not per link), and drop any that fail to
  // compile so one malformed user pattern can't throw and fail the whole crawl.
  const includeRes = compileGlobs(config?.includePaths)
  const excludeRes = compileGlobs(config?.excludePaths)
  const hasInclude = (config?.includePaths?.length ?? 0) > 0
  return links.filter((link) => {
    let parsed: URL
    try {
      parsed = new URL(link)
    } catch {
      return false
    }
    if (config?.allowSubdomains) {
      if (
        parsed.hostname !== baseDomain &&
        !parsed.hostname.endsWith(`.${baseDomain}`)
      )
        return false
    } else {
      if (parsed.hostname !== baseDomain) return false
    }
    const path = parsed.pathname
    if (hasInclude && !includeRes.some((re) => re.test(path))) return false
    if (excludeRes.some((re) => re.test(path))) return false
    return true
  })
}

/** Compile glob patterns to anchored RegExps, skipping any that don't compile. */
function compileGlobs(patterns?: string[]): RegExp[] {
  if (!patterns?.length) return []
  return patterns.flatMap((p) => {
    const re = globToRegExp(p)
    return re ? [re] : []
  })
}

/**
 * Translate a path glob to an anchored RegExp. Regex metacharacters are escaped
 * (so "." etc. are literal), then `**` -> `.*` (crosses path segments) and
 * `*` -> `[^/]*` (within a segment). Returns null if the result can't compile.
 */
function globToRegExp(pattern: string): RegExp | null {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  const regexStr = escaped
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
  try {
    return new RegExp(`^${regexStr}$`)
  } catch {
    return null
  }
}
