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
