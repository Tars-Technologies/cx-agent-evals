import type { LLMClient } from "../../base.js";
import type { Dimension } from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";

const DISCOVERY_PROMPT = `You are analyzing a company's website content to identify the key dimensions that would vary across real user questions asked to their AI assistant or support system.

For each dimension, provide:
- name: A short descriptive name (e.g., "User Persona", "Query Intent")
- description: Why this dimension matters for question diversity
- values: 3-8 concrete values as short snake_case identifiers

Consider these categories:
- User roles/personas (who asks)
- Question intents (why they ask)
- Complexity levels (how deep)
- Specificity levels (how narrow)
- Tone/formality (how they ask)
- Product areas or topics (what about)
- Any domain-specific axes of variation

Output JSON format:
{
  "dimensions": [
    {
      "name": "User Persona",
      "description": "Different types of users have different knowledge levels and needs",
      "values": ["new_user", "power_user", "admin", "developer"]
    }
  ]
}`;

export interface DiscoverDimensionsOptions {
  readonly url: string;
  readonly outputPath?: string;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly fetchPage?: (url: string) => Promise<string>;
}

export async function discoverDimensions(
  options: DiscoverDimensionsOptions,
): Promise<Dimension[]> {
  const fetchPage = options.fetchPage ?? defaultFetchPage;

  const mainContent = await fetchPage(options.url);
  const linkedUrls = extractSameDomainLinks(options.url, mainContent).slice(
    0,
    4,
  );

  const pages = [mainContent];
  for (const linkedUrl of linkedUrls) {
    try {
      pages.push(await fetchPage(linkedUrl));
    } catch {
      // Skip pages that fail to fetch
    }
  }

  const combinedContent = pages
    .map((p) => stripHtml(p).substring(0, 5000))
    .join("\n\n---\n\n");

  const prompt = `Here is content from a company's website:\n\n${combinedContent}\n\nIdentify the key dimensions for generating diverse user questions.`;

  const response = await options.llmClient.complete({
    model: options.model,
    messages: [
      { role: "system", content: DISCOVERY_PROMPT },
      { role: "user", content: prompt },
    ],
    responseFormat: "json",
  });

  const data = safeParseLLMResponse(response, { dimensions: [] as Dimension[] });
  const dimensions: Dimension[] = data.dimensions ?? [];

  if (options.outputPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      options.outputPath,
      JSON.stringify({ dimensions }, null, 2),
    );
  }

  return dimensions;
}

async function defaultFetchPage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSameDomainLinks(baseUrl: string, html: string): string[] {
  const baseHostname = new URL(baseUrl).hostname;
  const linkRegex = /href="([^"]+)"/g;
  const links = new Set<string>();

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (resolved.hostname === baseHostname && resolved.href !== baseUrl) {
        links.add(resolved.href);
      }
    } catch {
      // Skip invalid URLs
    }
  }

  return [...links];
}
