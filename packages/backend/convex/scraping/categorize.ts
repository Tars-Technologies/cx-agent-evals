"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getAuthContext } from "../lib/auth";

const MODEL_ID = "claude-sonnet-4-6";
const MAX_URLS_PER_BATCH = 300;

const SYSTEM_PROMPT = `You group webpage URLs into a small number of topic buckets so a user can quickly include or exclude whole sections of a site before importing.

Rules:
- Pick short, human-friendly topic names: 1–3 words, noun phrases, Title Case (e.g., "Plans", "Roaming", "Help & Support", "Investor Relations").
- Reuse the same topic name across related URLs. Prefer 5–12 distinct topics for a batch.
- Use the URL slug (path segments) as your primary signal. Ignore query strings.
- Pages that don't fit anywhere obvious go to "Other".
- Return ONLY a single JSON object on one line, no prose, no markdown fences.
- Shape: { "<url>": "<topic>", ... }
- Every input URL MUST appear as a key in the output, exactly as given.`;

/**
 * Group a list of URLs into topic buckets via Sonnet 4.6.
 * Standalone (not job-attached) — frontend calls this on demand to power the
 * topic-chip filter in the import modal.
 */
export const categorizeUrls = action({
  args: { urls: v.array(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ topics: Record<string, string> }> => {
    await getAuthContext(ctx);

    if (args.urls.length === 0) return { topics: {} };
    if (args.urls.length > MAX_URLS_PER_BATCH) {
      throw new Error(
        `Too many URLs to categorize at once (max ${MAX_URLS_PER_BATCH}, got ${args.urls.length}).`,
      );
    }

    const userPrompt = `URLs to categorize:\n${args.urls.map((u) => `- ${u}`).join("\n")}`;

    const result = await generateText({
      model: anthropic(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0,
    });

    const raw = result.text.trim();
    const jsonText = extractJsonObject(raw);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      throw new Error(
        `Failed to parse categorization response as JSON: ${e?.message}. Raw: ${raw.slice(0, 200)}`,
      );
    }

    const topics: Record<string, string> = {};
    for (const url of args.urls) {
      const t = parsed[url];
      topics[url] = typeof t === "string" && t.trim() ? t.trim() : "Other";
    }
    return { topics };
  },
});

function extractJsonObject(s: string): string {
  // Strip code fences if the model added them despite instructions.
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Grab the outermost {...} block.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return s;
}
