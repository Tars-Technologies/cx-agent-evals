import OpenAI from "openai";
import { OpenAIEmbedder } from "../embedders/openai.js";

/**
 * Create an OpenAIEmbedder instance.
 * Default model: text-embedding-3-small (1536 dimensions).
 */
export function createEmbedder(model?: string, apiKey?: string) {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey: key });
  return new OpenAIEmbedder({
    model: model ?? "text-embedding-3-small",
    client: openai,
  });
}
