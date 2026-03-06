export interface HtmlToMarkdownOptions {
  onlyMainContent?: boolean;
  baseUrl?: string;
}

export interface HtmlToMarkdownResult {
  content: string;
  title: string;
  links: string[];
}

export async function htmlToMarkdown(
  html: string,
  options?: HtmlToMarkdownOptions,
): Promise<HtmlToMarkdownResult> {
  // Dynamic imports — deferred so module-level init doesn't run during
  // Convex's push analysis phase.  All three deps are CJS, so .default may
  // or may not exist depending on the runtime's CJS/ESM interop behavior.
  const linkedomMod = await import("linkedom");
  const parseHTML: (html: string) => { document: any } =
    (linkedomMod as any).parseHTML ?? (linkedomMod as any).default?.parseHTML;

  const readabilityMod = await import("@mozilla/readability");
  const Readability: new (doc: any) => { parse(): { content: string; title: string } | null } =
    (readabilityMod as any).Readability ??
    (readabilityMod as any).default?.Readability;

  const turndownMod = await import("turndown");
  const TurndownService = (turndownMod as any).default ?? turndownMod;

  const onlyMainContent = options?.onlyMainContent ?? true;
  const baseUrl = options?.baseUrl;
  const { document: doc } = parseHTML(html) as { document: any };

  const links = extractLinks(doc, baseUrl);
  let title: string = doc.querySelector("title")?.textContent?.trim() || "";
  // Extract h1 before Readability mutates the DOM
  const h1Title: string = doc.querySelector("h1")?.textContent?.trim() || "";
  let htmlForConversion: string;

  if (onlyMainContent) {
    const reader = new Readability(doc);
    const article = reader.parse();
    if (article) {
      htmlForConversion = (article.content as string) || "";
      title = (article.title as string) || title;
    } else {
      htmlForConversion = doc.body?.innerHTML || html;
    }
  } else {
    htmlForConversion = doc.body?.innerHTML || html;
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  let markdown = turndown.turndown(htmlForConversion);
  markdown = cleanupMarkdown(markdown);

  // Title priority: <title> tag > Readability article.title > original h1 > first markdown heading
  if (!title) {
    title = h1Title;
  }
  if (!title) {
    const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1];
  }

  return { content: markdown, title, links };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLinks(doc: any, baseUrl?: string): string[] {
  const anchors = doc.querySelectorAll("a[href]");
  const links: string[] = [];
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:"))
      continue;
    try {
      const resolved = baseUrl ? new URL(href, baseUrl).href : href;
      links.push(resolved);
    } catch {
      /* skip malformed URLs */
    }
  }
  return [...new Set(links)];
}

function cleanupMarkdown(md: string): string {
  return md
    .replace(/<!-- .*? -->/gs, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
