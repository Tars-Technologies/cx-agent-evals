export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // Rebuild from getters rather than URL setters: Convex's non-Node runtime
    // doesn't implement the username/password setters. Dropping userinfo also
    // dedups `user:pass@host` to `host` and keeps credentials out of crawlUrls.
    const host = parsed.hostname.toLowerCase()
    const port = parsed.port ? `:${parsed.port}` : ""
    const params = new URLSearchParams(parsed.search)
    const search = new URLSearchParams([...params.entries()].sort()).toString()
    let pathname = parsed.pathname
    if (pathname.endsWith("/") && pathname !== "/")
      pathname = pathname.slice(0, -1)
    let result = `${parsed.protocol}//${host}${port}${pathname}`
    if (search) result += `?${search}`
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
