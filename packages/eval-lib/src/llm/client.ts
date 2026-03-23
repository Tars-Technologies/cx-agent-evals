import OpenAI from "openai";
import { openAIClientAdapter, type LLMClient } from "../synthetic-datagen/base.js";

/**
 * Create an LLMClient backed by OpenAI.
 * Requires OPENAI_API_KEY in the environment.
 */
export function createLLMClient(apiKey?: string): LLMClient {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Set it in your environment variables (.env.local for Next.js, Convex dashboard for backend).",
    );
  }
  const openai = new OpenAI({ apiKey: key });
  return openAIClientAdapter(openai as any);
}
