"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import Sitemapper from "sitemapper";
import { getAuthContext } from "../lib/auth";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RAG-EvalBot/1.0; +https://github.com/Tars-Technologies/cx-agent-evals)",
  Accept: "text/plain, application/xml, text/xml, */*;q=0.8",
};

const FETCH_TIMEOUT_MS = 20_000;

async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const sm = new Sitemapper({
    url: sitemapUrl,
    timeout: FETCH_TIMEOUT_MS,
    requestHeaders: REQUEST_HEADERS,
  });
  const { sites } = await sm.fetch();
  return sites as string[];
}

/**
 * Try common sitemap locations for a website. Returns the first one that
 * resolves to a non-empty URL list, plus the URLs it produced. Returns null
 * if no sitemap is discoverable so the caller can fall back to BFS crawling.
 *
 * Tried in parallel:
 *   1. {origin}/sitemap.xml
 *   2. {origin}/sitemap_index.xml
 *   3. Sitemap: directives from {origin}/robots.txt
 *
 * Earlier-listed candidates are preferred when multiple succeed.
 */
export const discoverSitemap = action({
  args: { startUrl: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{ sitemapUrl: string; urls: string[] } | null> => {
    await getAuthContext(_ctx);

    let origin: string;
    try {
      origin = new URL(args.startUrl).origin;
    } catch {
      return null;
    }

    const candidates: string[] = [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    ];

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${origin}/robots.txt`, {
          signal: controller.signal,
          headers: REQUEST_HEADERS,
        });
        if (res.ok) {
          const text = await res.text();
          const matches = text.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim);
          for (const m of matches) {
            const u = m[1];
            if (u && !candidates.includes(u)) candidates.push(u);
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // robots.txt unreachable — fine, proceed with the direct candidates.
    }

    const settled = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const urls = await fetchSitemapUrls(candidate);
        if (urls.length === 0) throw new Error("empty");
        return { sitemapUrl: candidate, urls };
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled") return result.value;
    }
    return null;
  },
});
