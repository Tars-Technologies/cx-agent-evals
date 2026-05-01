import type { Id } from "../_generated/dataModel";
import { wordCount } from "./lengthStats";

export type Message = {
  id: number;
  role: "user" | "human_agent" | "workflow_input";
  text: string;
};

export type Exemplar = {
  sourceTranscriptId: Id<"livechatConversations">;
  messages: Message[];
};

export type ScenarioForExtraction = {
  referenceTranscript?: Message[];
  referenceExemplars?: Exemplar[];
};

export type Example = { agent: string | null; user: string };

const MAX_EXAMPLES = 8;

/**
 * Find the immediately-preceding human_agent message before index `i`,
 * skipping over workflow_input rows. Returns null if none.
 */
function findPrecedingAgent(messages: Message[], i: number): string | null {
  for (let j = i - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role === "human_agent") return m.text;
    if (m.role === "workflow_input") continue;
    // Hit a `user` message before any human_agent → no agent context for this user reply
    return null;
  }
  return null;
}

function pairsFromTranscript(messages: Message[]): Example[] {
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") userIndices.push(i);
  }
  // Skip the very first user message (used verbatim as turn-0 opener)
  const eligible = userIndices.slice(1);
  return eligible.map((i) => ({
    agent: findPrecedingAgent(messages, i),
    user: messages[i].text,
  }));
}

export function extractExamples(scenario: ScenarioForExtraction): Example[] {
  if (scenario.referenceTranscript && scenario.referenceTranscript.length > 0) {
    const pairs = pairsFromTranscript(scenario.referenceTranscript);
    // Sort by user-message brevity ascending; cap at MAX_EXAMPLES
    pairs.sort((a, b) => wordCount(a.user) - wordCount(b.user));
    return pairs.slice(0, MAX_EXAMPLES);
  }
  if (scenario.referenceExemplars && scenario.referenceExemplars.length > 0) {
    const out: Example[] = [];
    for (const ex of scenario.referenceExemplars) {
      for (let i = 0; i < ex.messages.length; i++) {
        if (ex.messages[i].role !== "user") continue;
        out.push({
          agent: findPrecedingAgent(ex.messages, i),
          user: ex.messages[i].text,
        });
      }
    }
    return out;
  }
  return [];
}

export type ScenarioForPrompt = ScenarioForExtraction & {
  persona: {
    type: string;
    traits: string[];
    communicationStyle: string;
    patienceLevel: "low" | "medium" | "high";
  };
  topic: string;
  intent: string;
  complexity: string;
  reasonForContact: string;
  knownInfo: string;
  unknownInfo: string;
  instruction?: string;          // legacy prose; used only when no new fields exist
  behaviorAnchors?: string[];
  userMessageLengthStats?: { median: number; p90: number };
};

function legacyOnly(s: ScenarioForPrompt): boolean {
  const noAnchors = !s.behaviorAnchors || s.behaviorAnchors.length === 0;
  const noLengthStats = !s.userMessageLengthStats;
  const noTranscript = !s.referenceTranscript || s.referenceTranscript.length === 0;
  const noExemplars = !s.referenceExemplars || s.referenceExemplars.length === 0;
  return noAnchors && noLengthStats && noTranscript && noExemplars;
}

export function buildUserSimPrompt(scenario: ScenarioForPrompt, seed: number): string {
  const sections: string[] = [];

  sections.push(`# You
You are roleplaying an end-user contacting customer support. Stay in character.
Never reveal you are an AI.`);

  sections.push(`# Persona
- Type: ${scenario.persona.type}
- Traits: ${scenario.persona.traits.join(", ")}
- Communication style: ${scenario.persona.communicationStyle}
- Patience level: ${scenario.persona.patienceLevel}`);

  sections.push(`# Your goal
${scenario.intent}

Why you're contacting: ${scenario.reasonForContact}
Topic: ${scenario.topic}`);

  sections.push(`# What you know
${scenario.knownInfo}`);

  sections.push(`# What you don't know (and want to find out)
${scenario.unknownInfo}`);

  if (scenario.behaviorAnchors && scenario.behaviorAnchors.length > 0) {
    sections.push(
      `# How this user speaks\n` +
        scenario.behaviorAnchors.map((a) => `- ${a}`).join("\n"),
    );
  }

  if (scenario.userMessageLengthStats) {
    const { median: med, p90: p } = scenario.userMessageLengthStats;
    sections.push(`# Message length
Users in this conversation typically write ${med} words per message
(90th percentile: ${p}). Match that. If a thought is longer, split it
into several short messages instead of one long one.`);
  }

  const examples = extractExamples(scenario);
  if (examples.length > 0) {
    const rendered = examples.map((e) => {
      const agentLine = e.agent !== null ? `  agent: ${e.agent}` : `  (user spoke first)`;
      return `<example>\n${agentLine}\n  user:  ${e.user}\n</example>`;
    }).join("\n");
    sections.push(`# Style examples — real exchanges to imitate
Imitate the terseness and response pattern of these examples. Answer the
specific question. Do NOT volunteer unrelated info or context.

${rendered}`);
  }

  if (legacyOnly(scenario) && scenario.instruction) {
    sections.push(`# Instructions
${scenario.instruction}`);
  }

  sections.push(`# Rules
- Stay in character throughout.
- Don't reveal you're a simulator or mention evaluators/scoring.
- When your goal is met (or you have no more questions), respond with exactly: ###STOP###
- If asked to do something you can't simulate (open a URL, check email), make up a brief plausible response.`);

  sections.push(`# Variation: seed ${seed}
Subtly vary phrasing across re-runs. Don't break character or change goals.`);

  return sections.join("\n\n");
}
