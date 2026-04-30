import type { Id } from "../_generated/dataModel";
import type { Message, Exemplar } from "./prompt";
import { wordCount } from "./lengthStats";

type CorpusTranscript = {
  _id: Id<"livechatConversations">;
  messages: Message[];
};

type Candidate = {
  transcriptId: Id<"livechatConversations">;
  userIndex: number;
  transcript: CorpusTranscript;
  userText: string;
};

const SHORT_WORD_LIMIT = 30;

function collectCandidates(transcripts: CorpusTranscript[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of transcripts) {
    for (let i = 0; i < t.messages.length; i++) {
      const m = t.messages[i];
      if (m.role !== "user") continue;
      out.push({ transcriptId: t._id, userIndex: i, transcript: t, userText: m.text });
    }
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildExemplarMessages(transcript: CorpusTranscript, userIndex: number): Message[] {
  // Walk backward from userIndex to find the most recent human_agent message,
  // then include everything from that human_agent through the user message.
  let agentIdx = -1;
  for (let j = userIndex - 1; j >= 0; j--) {
    if (transcript.messages[j].role === "human_agent") {
      agentIdx = j;
      break;
    }
  }
  const start = agentIdx >= 0 ? agentIdx : userIndex;
  return transcript.messages.slice(start, userIndex + 1);
}

export function sampleCorpusExemplars(
  transcripts: CorpusTranscript[],
  count: number,
): Exemplar[] {
  const all = collectCandidates(transcripts);
  if (all.length === 0) return [];

  const short = all.filter((c) => wordCount(c.userText) <= SHORT_WORD_LIMIT);
  const pool = short.length >= count ? short : (short.length > 0 ? short : all);
  const picked = shuffle(pool).slice(0, count);

  return picked.map((c) => ({
    sourceTranscriptId: c.transcriptId,
    messages: buildExemplarMessages(c.transcript, c.userIndex),
  }));
}
