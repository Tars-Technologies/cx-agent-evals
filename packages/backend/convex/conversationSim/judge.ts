"use node"

// LLM judge — plain async function (NOT a Convex action).
// Called directly from the simulation action (Task 7) which is also "use node".

import { type CoreMessage, generateText } from "ai"
import { resolveModel } from "../lib/agentLoop"
import { fetchImageAsBase64 } from "../lib/vision"

export interface JudgeConfig {
  rubric: string
  passExamples: string[]
  failExamples: string[]
  model: string
  inputContext: Array<
    "transcript" | "tool_calls" | "kb_documents" | "shown_images"
  >
}

export interface JudgeContext {
  transcript: string
  toolCalls?: string
  kbDocuments?: string
  /** Images the agent actually rendered across the run (fed as pixels). */
  shownImages?: Array<{ imageId: string; url: string; alt: string }>
  /** Everything the retrieval menu offered — for recall (skipped-image) checks. */
  imageMenu?: Array<{ imageId: string; alt: string; type?: string }>
}

export interface JudgeResult {
  passed: boolean
  justification: string
}

function parseJudgeOutput(raw: string): JudgeResult {
  try {
    const parsed = JSON.parse(raw.trim())
    return {
      passed: Boolean(parsed.passed),
      justification: String(parsed.justification ?? "No justification provided")
    }
  } catch {
    // Fallback: try to extract pass/fail from the raw text
    const text = raw.toLowerCase()
    const passed =
      text.includes('"passed": true') || text.includes('"passed":true')
    return {
      passed,
      justification: `Judge response (parse fallback): ${raw.slice(0, 200)}`
    }
  }
}

export async function runLLMJudge(
  config: JudgeConfig,
  context: JudgeContext
): Promise<JudgeResult> {
  const contextParts: string[] = []

  if (config.inputContext.includes("transcript")) {
    contextParts.push(`## Conversation Transcript\n${context.transcript}`)
  }
  if (config.inputContext.includes("tool_calls") && context.toolCalls) {
    contextParts.push(`## Tool Calls\n${context.toolCalls}`)
  }
  if (config.inputContext.includes("kb_documents") && context.kbDocuments) {
    contextParts.push(`## Retrieved KB Documents\n${context.kbDocuments}`)
  }

  // Vision branch: the judge sees the pixels of every image the agent showed,
  // plus a text listing of the full menu (available images) so it can penalise
  // both irrelevant shown images (precision) and skipped-relevant ones (recall).
  const wantsImages = config.inputContext.includes("shown_images")
  const shown = context.shownImages ?? []
  const menu = context.imageMenu ?? []
  if (wantsImages) {
    const shownList =
      shown.length > 0
        ? shown.map((s) => `- ${s.imageId}: "${s.alt}"`).join("\n")
        : "- (none — the agent showed no images)"
    const menuList =
      menu.length > 0
        ? menu
            .map((m) => `- ${m.imageId} [${m.type ?? "image"}]: "${m.alt}"`)
            .join("\n")
        : "- (none)"
    contextParts.push(
      `## Images the agent SHOWED (pixels below)\n${shownList}\n\n## Images AVAILABLE in retrieval (the menu)\n${menuList}`
    )
  }

  const prompt = `You are an evaluation judge for a customer support AI agent.

## Rubric
${config.rubric}

## Examples of PASS
${config.passExamples.map((e) => `- ${e}`).join("\n")}

## Examples of FAIL
${config.failExamples.map((e) => `- ${e}`).join("\n")}

${contextParts.join("\n\n")}

Evaluate the agent's performance against the rubric. Respond with EXACTLY this JSON format:
{"passed": true/false, "justification": "Brief justification (1-2 sentences)"}

Respond ONLY with the JSON object.`

  // Fetch pixels only for actual images (img_ prefix); videos/docs have none.
  // detail:"low" bills a flat ~85 tokens/image on OpenAI — a relevance judge
  // doesn't need full resolution. Unknown providerOptions are ignored by other
  // providers, so this stays safe if the judge model isn't OpenAI.
  const imageParts: Extract<CoreMessage, { role: "user" }>["content"] = []
  if (wantsImages) {
    const fetched = await Promise.all(
      shown
        .filter((s) => s.imageId.startsWith("img_"))
        .map(async (s) => ({ s, bytes: await fetchImageAsBase64(s.url) }))
    )
    for (const { s, bytes } of fetched) {
      if (!bytes) continue
      imageParts.push({ type: "text", text: `Image ${s.imageId} ("${s.alt}"):` })
      imageParts.push({
        type: "image",
        image: bytes.data,
        mimeType: bytes.mimeType,
        providerOptions: { openai: { imageDetail: "low" } }
      })
    }
  }

  const result =
    imageParts.length > 0
      ? await generateText({
          model: resolveModel(config.model),
          messages: [
            { role: "user", content: [{ type: "text", text: prompt }, ...imageParts] }
          ],
          temperature: 0
        })
      : await generateText({
          model: resolveModel(config.model),
          prompt,
          temperature: 0
        })

  return parseJudgeOutput(result.text)
}
