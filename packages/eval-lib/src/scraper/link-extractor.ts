export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.hash = ""
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
    if (config?.includePaths?.length) {
      if (!config.includePaths.some((p) => matchGlob(path, p))) return false
    }
    if (config?.excludePaths?.length) {
      if (config.excludePaths.some((p) => matchGlob(path, p))) return false
    }
    return true
  })
}

function matchGlob(path: string, pattern: string): boolean {
  if (path === pattern) return true
  const regexStr = pattern
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
  return new RegExp(`^${regexStr}$`).test(path)
}
