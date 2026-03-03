export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Lowercase host
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip fragment
    parsed.hash = "";
    // Sort query params
    const params = new URLSearchParams(parsed.search);
    const sorted = new URLSearchParams([...params.entries()].sort());
    parsed.search = sorted.toString();

    let result = parsed.href;
    // Strip trailing slash on root path when followed by query string
    if (parsed.pathname === "/" && parsed.search) {
      result = result.replace("/?", "?");
    }
    // Strip trailing slash (non-root paths)
    if (result.endsWith("/") && parsed.pathname !== "/") {
      result = result.slice(0, -1);
    }
    // Strip trailing slash on root if no query/hash
    if (result.endsWith("/") && !parsed.search) {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}

function matchesGlob(path: string, pattern: string): boolean {
  // Simple glob: * matches any segment, ** matches multiple segments
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}

export function filterLinks(
  links: string[],
  baseUrl: string,
  config?: {
    includePaths?: string[];
    excludePaths?: string[];
    allowSubdomains?: boolean;
  },
): string[] {
  const base = new URL(baseUrl);
  const baseDomain = base.hostname;

  return links.filter((link) => {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      return false;
    }

    // Domain check
    const isSameDomain = parsed.hostname === baseDomain;
    const isSubdomain =
      parsed.hostname.endsWith(`.${baseDomain}`) &&
      parsed.hostname !== baseDomain;

    if (!isSameDomain && !(config?.allowSubdomains && isSubdomain)) {
      return false;
    }

    const path = parsed.pathname;

    // Include filter (if specified, only matching paths pass)
    if (config?.includePaths?.length) {
      const included = config.includePaths.some((p) => matchesGlob(path, p));
      if (!included) return false;
    }

    // Exclude filter
    if (config?.excludePaths?.length) {
      const excluded = config.excludePaths.some((p) => matchesGlob(path, p));
      if (excluded) return false;
    }

    return true;
  });
}
