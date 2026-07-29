/**
 * Vision-LLM image relevance judge for ground truth labeling.
 *
 * Given a question and a set of image candidates (with pixels), asks a
 * vision-capable model which images are relevant to answering the question.
 * Returns only imageIds that appeared in the candidate list (hallucination
 * guard). Candidates without usable pixels are silently skipped.
 *
 * Uses a minimal OpenAI-compatible interface so it works with any openai
 * package version the caller has installed (v4 or v6).
 */

import { safeParseLLMResponse } from "../utils/json.js"

/**
 * Minimal subset of the OpenAI client needed for vision completions.
 * Satisfied by both openai@4 and openai@6 — keeps the function decoupled from
 * a specific package version.
 */
export interface OpenAIVisionClient {
  chat: {
    completions: {
      create(params: {
        model: string
        messages: Array<{
          role: string
          content:
            | string
            | Array<{
                type: string
                text?: string
                image_url?: { url: string; detail?: string }
              }>
        }>
        response_format?: { type: string }
        max_tokens?: number
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>
    }
  }
}

export interface ImageJudgeCandidate {
  imageId: string
  base64: string
  mimeType: string
  alt: string
}

const SYSTEM_PROMPT = `You are evaluating image relevance for a question-answering system.

Given a question and a set of images from a source document, identify which images are relevant to answering the question. An image is relevant if it contains information that directly answers or meaningfully supports the answer.

Return JSON only: { "relevantIds": ["imageId1", "imageId2"] }
Return an empty array if no images are relevant. Do not include IDs not listed in the question.`

/**
 * Ask a vision-capable model which candidates are relevant to the question.
 *
 * @param question   The evaluation question text
 * @param candidates Images to judge — only those with valid pixels are sent
 * @param openai     OpenAI client instance (requires OPENAI_API_KEY)
 * @param model      Vision-capable model id (e.g. "gpt-4o-mini")
 * @returns Subset of candidate imageIds judged relevant, never hallucinated ids
 */
export async function judgeImageRelevance(
  question: string,
  candidates: ImageJudgeCandidate[],
  openai: OpenAIVisionClient,
  model: string
): Promise<string[]> {
  if (candidates.length === 0) return []

  const idList = candidates
    .map((c, i) => `Image ${i + 1}: id="${c.imageId}" alt="${c.alt}"`)
    .join("\n")

  const userText =
    `Question: ${question}\n\n` +
    `Images from the source document (${candidates.length} total):\n${idList}\n\n` +
    `Which of these images are relevant to answering the question? ` +
    `Return JSON: { "relevantIds": ["id1", ...] }`

  const imageParts = candidates.map((c) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${c.mimeType};base64,${c.base64}`,
      detail: "low" as const
    }
  }))

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [{ type: "text" as const, text: userText }, ...imageParts]
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 256
  })

  const raw = response.choices[0]?.message.content ?? ""
  const parsed = safeParseLLMResponse<{ relevantIds?: unknown }>(raw, {})

  if (!Array.isArray(parsed.relevantIds)) return []

  const validIds = new Set(candidates.map((c) => c.imageId))
  return parsed.relevantIds.filter(
    (id): id is string => typeof id === "string" && validIds.has(id)
  )
}
