# Livechat Transcript Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data analysis module that parses livechat CSV transcripts into structured JSON, segments conversations into categorized microtopics using Claude Sonnet 4.6, and provides a frontend UI to browse/export the results.

**Architecture:** Two main subsystems — (1) `packages/eval-lib/src/data-analysis/` with TypeScript types, deterministic parsers, and an AI-assisted microtopic extractor with CLI runners, and (2) `packages/frontend/src/components/livechat/` with a self-contained UI embedded in the KB page via a vertical icon rail, featuring Stats/Transcripts/Microtopics tabs. JSON files bridge the two — no database.

**Tech Stack:** TypeScript, csv-parse (streaming CSV), @anthropic-ai/sdk (Claude Sonnet 4.6 via tool use), Next.js 16 API routes, React, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-04-02-livechat-transcript-analysis-design.md`

---

## File Map

### eval-lib (new files)

| File | Responsibility |
|------|---------------|
| `packages/eval-lib/src/data-analysis/types.ts` | All TypeScript interfaces: RawMessage, RawConversation, RawTranscriptsFile, MicrotopicType, Exchange, Microtopic, ConversationMicrotopics, MicrotopicsFile, BasicStats, TopicTypeExport, LLMExtractionResult |
| `packages/eval-lib/src/data-analysis/csv-parser.ts` | Streaming CSV parser using csv-parse. Exports `parseCSV(filePath): AsyncIterable<Record<string, string>>` |
| `packages/eval-lib/src/data-analysis/transcript-parser.ts` | Deterministic `" \|\| "`-delimited transcript string → `RawMessage[]`. Exports `parseTranscript(transcript: string): RawMessage[]` and `parseBotFlowInput(text: string): { rawText, intent, language }` |
| `packages/eval-lib/src/data-analysis/basic-stats.ts` | Accumulate CSV metadata into `BasicStats`. Exports `computeBasicStats(conversations: AsyncIterable<Record<string, string>>): Promise<BasicStats>` |
| `packages/eval-lib/src/data-analysis/microtopic-extractor.ts` | Phases A+B+C: pre-process, call Claude, assemble. Exports `extractMicrotopics(conversations: RawConversation[], options: { claudeClient, limit?, concurrency? }): Promise<MicrotopicsFile>` |
| `packages/eval-lib/src/data-analysis/claude-client.ts` | Anthropic SDK wrapper. Exports `createClaudeClient(apiKey?: string)` and `classifyConversation(client, messages): Promise<LLMExtractionResult>` |
| `packages/eval-lib/src/data-analysis/index.ts` | Public re-exports |
| `packages/eval-lib/src/data-analysis/run-stats.ts` | CLI entry: `--input CSV --output JSON` |
| `packages/eval-lib/src/data-analysis/run-parse.ts` | CLI entry: `--input CSV --output JSON` |
| `packages/eval-lib/src/data-analysis/run-microtopics.ts` | CLI entry: `--input raw-transcripts.json --output microtopics.json --limit N --concurrency N` |

### eval-lib (modified files)

| File | Change |
|------|--------|
| `packages/eval-lib/package.json` | Add `csv-parse` dep, `@anthropic-ai/sdk` optionalDep, `"./data-analysis"` export |
| `packages/eval-lib/tsup.config.ts` | Add entry `"src/data-analysis/index.ts"`, externals `"@anthropic-ai/sdk"`, `"csv-parse"` |

### Tests (new files)

| File | What it tests |
|------|--------------|
| `packages/eval-lib/tests/unit/data-analysis/transcript-parser.test.ts` | parseTranscript, parseBotFlowInput — all edge cases |
| `packages/eval-lib/tests/unit/data-analysis/basic-stats.test.ts` | computeBasicStats with mock CSV rows |
| `packages/eval-lib/tests/unit/data-analysis/microtopic-extractor.test.ts` | Phase A pre-processing, Phase C assembly + validation |

### Frontend (new files)

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/components/livechat/types.ts` | Frontend types: UploadEntry, ViewState, MicrotopicsByType index |
| `packages/frontend/src/components/livechat/LivechatView.tsx` | Root: upload sidebar (inline) + tab bar + tab content + data loading |
| `packages/frontend/src/components/livechat/TabBar.tsx` | Stats / Transcripts / Microtopics tabs |
| `packages/frontend/src/components/livechat/StatsTab.tsx` | Stats dashboard cards |
| `packages/frontend/src/components/livechat/TranscriptsTab.tsx` | Conversation list + chat bubble detail |
| `packages/frontend/src/components/livechat/MicrotopicsTab.tsx` | Toggle + By Conversation / By Topic Type views |
| `packages/frontend/src/components/livechat/ConversationList.tsx` | Reusable scrollable conversation list |
| `packages/frontend/src/components/livechat/ChatBubble.tsx` | Message bubble (user/agent/workflow) |
| `packages/frontend/src/components/livechat/MicrotopicCard.tsx` | Collapsible accordion card |
| `packages/frontend/src/components/livechat/TopicTypeFeed.tsx` | Flat feed for By Topic Type |
| `packages/frontend/src/components/livechat/ExportButton.tsx` | JSON export button |
| `packages/frontend/src/app/api/livechat/upload/route.ts` | Upload CSV, run processing pipeline |
| `packages/frontend/src/app/api/livechat/manifest/route.ts` | GET manifest, status polling |
| `packages/frontend/src/app/api/livechat/data/[id]/route.ts` | Serve processed JSON files |

### Frontend (modified files)

| File | Change |
|------|--------|
| `packages/frontend/src/app/kb/page.tsx` | Add icon rail + conditional render of LivechatView |

### Other

| File | Change |
|------|--------|
| `.gitignore` | Add `data/output/` and `data/uploads/` |

---

## Task 1: Dependencies & Build Config

**Files:**
- Modify: `packages/eval-lib/package.json`
- Modify: `packages/eval-lib/tsup.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install csv-parse and @anthropic-ai/sdk**

```bash
cd packages/eval-lib && pnpm add csv-parse && pnpm add -O @anthropic-ai/sdk
```

- [ ] **Step 2: Add sub-path export to package.json**

In `packages/eval-lib/package.json`, add inside the `"exports"` object (after the `"./registry"` entry):

```json
"./data-analysis": {
  "types": "./dist/data-analysis/index.d.ts",
  "import": "./dist/data-analysis/index.js"
}
```

- [ ] **Step 3: Update tsup.config.ts**

In `packages/eval-lib/tsup.config.ts`, add `"src/data-analysis/index.ts"` to the `entry` array, and add `"@anthropic-ai/sdk"` and `"csv-parse"` to the `external` array.

Add to `entry` array:
```typescript
"src/data-analysis/index.ts",
```

Add to `external` array:
```typescript
"@anthropic-ai/sdk",
"csv-parse",
```

- [ ] **Step 4: Update .gitignore**

Add these lines to the project root `.gitignore`:

```
data/output/
data/uploads/
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build
```

Expected: Build succeeds (data-analysis entry point doesn't exist yet, so tsup may warn but not fail).

- [ ] **Step 6: Commit**

```bash
git add packages/eval-lib/package.json packages/eval-lib/tsup.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: add csv-parse and @anthropic-ai/sdk deps, data-analysis sub-path export"
```

---

## Task 2: Types

**Files:**
- Create: `packages/eval-lib/src/data-analysis/types.ts`
- Create: `packages/eval-lib/src/data-analysis/index.ts`

- [ ] **Step 1: Create types.ts with all interfaces**

Create `packages/eval-lib/src/data-analysis/types.ts`:

```typescript
// ── Roles ──
export type MessageRole = "user" | "human_agent" | "workflow_input";

// ── JSON 1: Raw Transcripts ──
export interface RawMessage {
  id: number;
  role: MessageRole;
  text: string;
}

export interface RawConversation {
  conversationId: string;
  visitorId: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string;
  agentId: string;
  agentName: string;
  agentEmail: string;
  inbox: string;
  labels: string[];
  status: string;
  messages: RawMessage[];
  metadata: {
    messageCountVisitor: number;
    messageCountAgent: number;
    totalDurationSeconds: number;
    startDate: string;
    startTime: string;
    replyDate: string;
    replyTime: string;
    lastActivityDate: string;
    lastActivityTime: string;
  };
}

export interface RawTranscriptsFile {
  source: string;
  generatedAt: string;
  totalConversations: number;
  conversations: RawConversation[];
}

// ── JSON 2: Microtopics ──
export type MicrotopicType =
  | "identity_info"
  | "question"
  | "request"
  | "confirmation"
  | "greeting"
  | "closing"
  | "uncategorized";

export interface MicrotopicMessage {
  id: number;
  role: MessageRole;
  text: string;
}

export interface Exchange {
  label: "primary" | "follow_up";
  messages: MicrotopicMessage[];
}

export interface ExtractedInfo {
  type: string;
  value: string;
}

export interface Microtopic {
  type: MicrotopicType;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];
}

export interface BotFlowInput {
  rawText: string;
  intent: string;
  language: string;
  messageIds: number[];
}

export interface ConversationMicrotopics {
  conversationId: string;
  language: string;
  botFlowInput?: BotFlowInput;
  microtopics: Microtopic[];
}

export interface MicrotopicsFile {
  source: string;
  generatedAt: string;
  model: string;
  totalConversations: number;
  processedConversations: number;
  failures: string[];
  conversations: ConversationMicrotopics[];
}

// ── LLM Output (ID-only, no text) ──
export interface LLMExchangeResult {
  label: "primary" | "follow_up";
  messageIds: number[];
}

export interface LLMMicrotopicResult {
  type: MicrotopicType;
  exchanges: LLMExchangeResult[];
  extracted?: ExtractedInfo[];
}

export interface LLMExtractionResult {
  microtopics: LLMMicrotopicResult[];
}

// ── JSON 3: Basic Stats ──
export interface AgentStats {
  agentName: string;
  agentEmail: string;
  conversationCount: number;
  totalMessagesFromAgent: number;
}

export interface BasicStats {
  source: string;
  generatedAt: string;
  totalConversations: number;
  conversationsWithUserMessages: number;
  conversationsWithoutUserMessages: number;
  uniqueVisitors: number;
  uniqueAgents: number;
  statusBreakdown: Record<string, number>;
  labelBreakdown: Record<string, number>;
  agentBreakdown: AgentStats[];
  visitorStats: {
    avgMessagesPerConversation: number;
    medianMessagesPerConversation: number;
  };
  agentStats: {
    avgMessagesPerConversation: number;
    medianMessagesPerConversation: number;
  };
  durationStats: {
    avgDurationSeconds: number;
    medianDurationSeconds: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
  };
  timeRange: {
    earliestStart: string;
    latestStart: string;
  };
}

// ── Export Format (frontend topic type export) ──
export interface TopicTypeExportItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];
}

export interface TopicTypeExport {
  type: MicrotopicType;
  exportedAt: string;
  source: string;
  totalItems: number;
  items: TopicTypeExportItem[];
}
```

- [ ] **Step 2: Create index.ts**

Create `packages/eval-lib/src/data-analysis/index.ts`:

```typescript
export * from "./types.js";
export { parseTranscript, parseBotFlowInput } from "./transcript-parser.js";
export { parseCSV } from "./csv-parser.js";
export { computeBasicStats } from "./basic-stats.js";
export { extractMicrotopics } from "./microtopic-extractor.js";
export { createClaudeClient, classifyConversation } from "./claude-client.js";
```

Note: The imports will fail until the modules are created. That's expected.

- [ ] **Step 3: Commit**

```bash
git add packages/eval-lib/src/data-analysis/types.ts packages/eval-lib/src/data-analysis/index.ts
git commit -m "feat(data-analysis): add all TypeScript types and index"
```

---

## Task 3: Transcript Parser (TDD)

**Files:**
- Create: `packages/eval-lib/tests/unit/data-analysis/transcript-parser.test.ts`
- Create: `packages/eval-lib/src/data-analysis/transcript-parser.ts`

- [ ] **Step 1: Write failing tests for parseTranscript**

Create `packages/eval-lib/tests/unit/data-analysis/transcript-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseTranscript,
  parseBotFlowInput,
} from "../../../src/data-analysis/transcript-parser.js";

describe("parseTranscript", () => {
  it("should parse a simple visitor/agent exchange", () => {
    const transcript = "Visitor : Hello || Agent : Hi there";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Hello" },
      { id: 2, role: "human_agent", text: "Hi there" },
    ]);
  });

  it("should parse Unknown as workflow_input", () => {
    const transcript = "Unknown : Assigned to John by Admin";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "workflow_input", text: "Assigned to John by Admin" },
    ]);
  });

  it("should handle multi-message transcripts with all three roles", () => {
    const transcript =
      "Visitor : Hi || Unknown : Assigned to Agent1 by Bot || Agent : Welcome!";
    const messages = parseTranscript(transcript);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ id: 1, role: "user", text: "Hi" });
    expect(messages[1]).toEqual({
      id: 2,
      role: "workflow_input",
      text: "Assigned to Agent1 by Bot",
    });
    expect(messages[2]).toEqual({ id: 3, role: "human_agent", text: "Welcome!" });
  });

  it("should return empty array for empty transcript", () => {
    expect(parseTranscript("")).toEqual([]);
  });

  it("should handle transcript with no delimiters as single message", () => {
    const messages = parseTranscript("Visitor : Just one message");
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Just one message" },
    ]);
  });

  it("should default to workflow_input when speaker prefix is missing", () => {
    const messages = parseTranscript("Some random text without prefix");
    expect(messages).toEqual([
      { id: 1, role: "workflow_input", text: "Some random text without prefix" },
    ]);
  });

  it("should skip whitespace-only segments", () => {
    const transcript = "Visitor : Hello ||  || Agent : Hi";
    const messages = parseTranscript(transcript);
    expect(messages).toEqual([
      { id: 1, role: "user", text: "Hello" },
      { id: 2, role: "human_agent", text: "Hi" },
    ]);
  });

  it("should preserve newlines within message text", () => {
    const transcript = "Agent : Line 1\nLine 2\nLine 3";
    const messages = parseTranscript(transcript);
    expect(messages[0].text).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should handle extra spaces around speaker prefix", () => {
    const transcript = "Visitor  :  Hello there";
    const messages = parseTranscript(transcript);
    expect(messages[0]).toEqual({ id: 1, role: "user", text: "Hello there" });
  });
});

describe("parseBotFlowInput", () => {
  it("should extract intent and language from typical bot flow", () => {
    const result = parseBotFlowInput(
      "Continue in English, -No Input-, New Postpaid Plan, English,"
    );
    expect(result.intent).toBe("New Postpaid Plan");
    expect(result.language).toBe("English");
    expect(result.rawText).toBe(
      "Continue in English, -No Input-, New Postpaid Plan, English,"
    );
  });

  it("should handle Arabic language switch", () => {
    const result = parseBotFlowInput(
      "تبديل إلى العربية, -No Input-, اشتراك شهري جديد, Arabic, , ,"
    );
    expect(result.language).toBe("Arabic");
    expect(result.intent).toBe("اشتراك شهري جديد");
  });

  it("should handle GigaHome intent", () => {
    const result = parseBotFlowInput(
      "Hi, I want to know more about Vodafones GigaHome plans."
    );
    // This doesn't match the comma-separated pattern
    expect(result.intent).toBe("unknown");
    expect(result.language).toBe("unknown");
    expect(result.rawText).toBe(
      "Hi, I want to know more about Vodafones GigaHome plans."
    );
  });

  it("should join multiple intent tokens with /", () => {
    const result = parseBotFlowInput(
      "Continue in English, New Postpaid Plan, Upgrade, English,"
    );
    expect(result.intent).toBe("New Postpaid Plan / Upgrade");
    expect(result.language).toBe("English");
  });

  it("should set unknown when no language found", () => {
    const result = parseBotFlowInput("Some random text");
    expect(result.language).toBe("unknown");
    expect(result.intent).toBe("unknown");
  });

  it("should handle empty string", () => {
    const result = parseBotFlowInput("");
    expect(result.language).toBe("unknown");
    expect(result.intent).toBe("unknown");
    expect(result.rawText).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/transcript-parser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement transcript-parser.ts**

Create `packages/eval-lib/src/data-analysis/transcript-parser.ts`:

```typescript
import type { RawMessage, MessageRole, BotFlowInput } from "./types.js";

const SPEAKER_REGEX = /^(Visitor|Agent|Unknown)\s*:\s*/;

const SPEAKER_ROLE_MAP: Record<string, MessageRole> = {
  Visitor: "user",
  Agent: "human_agent",
  Unknown: "workflow_input",
};

const KNOWN_LANGUAGES = ["English", "Arabic"];
const NOISE_PHRASES = ["-No Input-", "Continue in English", "تبديل إلى العربية"];

/**
 * Parse a transcript string (` || `-delimited) into an array of RawMessage objects.
 * Purely deterministic — no AI involved.
 */
export function parseTranscript(transcript: string): RawMessage[] {
  if (!transcript || !transcript.trim()) return [];

  const segments = transcript.split(" || ");
  const messages: RawMessage[] = [];
  let id = 1;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const match = trimmed.match(SPEAKER_REGEX);
    let role: MessageRole;
    let text: string;

    if (match) {
      role = SPEAKER_ROLE_MAP[match[1]];
      text = trimmed.slice(match[0].length);
    } else {
      role = "workflow_input";
      text = trimmed;
    }

    messages.push({ id: id++, role, text });
  }

  return messages;
}

/**
 * Parse a bot flow input message into structured intent/language.
 * Bot flow messages are comma-separated values like:
 * "Continue in English, -No Input-, New Postpaid Plan, English,"
 */
export function parseBotFlowInput(text: string): BotFlowInput {
  const result: BotFlowInput = {
    rawText: text,
    intent: "unknown",
    language: "unknown",
    messageIds: [],
  };

  if (!text || !text.trim()) return result;

  // Must have at least 2 commas to be the structured bot flow pattern
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount < 2) return result;

  const tokens = text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Filter out noise phrases
  const cleaned = tokens.filter(
    (t) => !NOISE_PHRASES.some((noise) => t === noise)
  );

  // Find and extract language (last matching token)
  let language = "unknown";
  const withoutLanguage: string[] = [];
  let foundLanguage = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (!foundLanguage && KNOWN_LANGUAGES.includes(cleaned[i])) {
      language = cleaned[i];
      foundLanguage = true;
    } else {
      withoutLanguage.unshift(cleaned[i]);
    }
  }

  result.language = language;

  // Remaining substantive tokens are intent candidates
  const intents = withoutLanguage.filter((t) => t.length > 1);

  if (intents.length === 1) {
    result.intent = intents[0];
  } else if (intents.length > 1) {
    result.intent = intents.join(" / ");
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/transcript-parser.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/transcript-parser.ts packages/eval-lib/tests/unit/data-analysis/transcript-parser.test.ts
git commit -m "feat(data-analysis): add transcript parser with TDD tests"
```

---

## Task 4: CSV Parser

**Files:**
- Create: `packages/eval-lib/src/data-analysis/csv-parser.ts`

- [ ] **Step 1: Implement csv-parser.ts**

Create `packages/eval-lib/src/data-analysis/csv-parser.ts`:

```typescript
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

/**
 * Stream a CSV file row-by-row. Handles quoted fields with newlines.
 * Yields one Record<string, string> per CSV row (header-mapped).
 */
export async function* parseCSV(
  filePath: string
): AsyncIterable<Record<string, string>> {
  const parser = createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    })
  );

  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

/**
 * Parse CLI args from process.argv.
 * Supports: --input, --output, --limit, --concurrency
 */
export function parseCLIArgs(argv: string[]): {
  input: string;
  output: string;
  limit?: number;
  concurrency?: number;
} {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }

  if (!args.input) throw new Error("Missing --input argument");
  if (!args.output) throw new Error("Missing --output argument");

  return {
    input: args.input,
    output: args.output,
    limit: args.limit ? parseInt(args.limit, 10) : undefined,
    concurrency: args.concurrency ? parseInt(args.concurrency, 10) : undefined,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/eval-lib/src/data-analysis/csv-parser.ts
git commit -m "feat(data-analysis): add streaming CSV parser and CLI arg helper"
```

---

## Task 5: Basic Stats (TDD)

**Files:**
- Create: `packages/eval-lib/tests/unit/data-analysis/basic-stats.test.ts`
- Create: `packages/eval-lib/src/data-analysis/basic-stats.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/data-analysis/basic-stats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeBasicStats } from "../../../src/data-analysis/basic-stats.js";

function makeRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    "Conversation ID": "1",
    "Visitor ID": "v1",
    "Visitor Name": "Test",
    "Visitor Email": "",
    "Visitor Phone": "+123",
    "Agent ID": "a1",
    "Agent Name": "Agent One",
    "Agent Email": "a1@test.com",
    "Inbox ID": "1",
    "Inbox": "Test Inbox",
    "Labels": "label_a,label_b",
    "Status": "Resolved",
    "Transcript": "Visitor : Hello || Agent : Hi",
    "Number of messages sent by the visitor": "1",
    "Number of messages sent by the agent": "1",
    "Total Conversation duration in Seconds": "600",
    "Start Date": "01/07/2025",
    "Start Time": "12:00:00 AM",
    "Reply Date": "01/07/2025",
    "Reply Time": "12:01:00 AM",
    "Last Activity Date": "01/07/2025",
    "Last Activity Time": "12:10:00 AM",
    ...overrides,
  };
}

async function* toAsyncIterable(rows: Record<string, string>[]) {
  for (const row of rows) yield row;
}

describe("computeBasicStats", () => {
  it("should count total conversations", async () => {
    const stats = await computeBasicStats(toAsyncIterable([makeRow(), makeRow({ "Conversation ID": "2" })]));
    expect(stats.totalConversations).toBe(2);
  });

  it("should count unique visitors and agents", async () => {
    const rows = [
      makeRow({ "Visitor ID": "v1", "Agent ID": "a1" }),
      makeRow({ "Conversation ID": "2", "Visitor ID": "v2", "Agent ID": "a1" }),
      makeRow({ "Conversation ID": "3", "Visitor ID": "v1", "Agent ID": "a2" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.uniqueVisitors).toBe(2);
    expect(stats.uniqueAgents).toBe(2);
  });

  it("should count conversations with and without user messages", async () => {
    const rows = [
      makeRow({ "Number of messages sent by the visitor": "5" }),
      makeRow({ "Conversation ID": "2", "Number of messages sent by the visitor": "0" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.conversationsWithUserMessages).toBe(1);
    expect(stats.conversationsWithoutUserMessages).toBe(1);
  });

  it("should compute duration stats", async () => {
    const rows = [
      makeRow({ "Total Conversation duration in Seconds": "100" }),
      makeRow({ "Conversation ID": "2", "Total Conversation duration in Seconds": "200" }),
      makeRow({ "Conversation ID": "3", "Total Conversation duration in Seconds": "300" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.durationStats.avgDurationSeconds).toBe(200);
    expect(stats.durationStats.medianDurationSeconds).toBe(200);
    expect(stats.durationStats.minDurationSeconds).toBe(100);
    expect(stats.durationStats.maxDurationSeconds).toBe(300);
  });

  it("should break down labels", async () => {
    const rows = [
      makeRow({ "Labels": "campaign_mobile,language_english" }),
      makeRow({ "Conversation ID": "2", "Labels": "campaign_mobile,language_arabic" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.labelBreakdown["campaign_mobile"]).toBe(2);
    expect(stats.labelBreakdown["language_english"]).toBe(1);
    expect(stats.labelBreakdown["language_arabic"]).toBe(1);
  });

  it("should break down agents", async () => {
    const rows = [
      makeRow({ "Agent Name": "Aya", "Agent Email": "aya@test.com", "Number of messages sent by the agent": "10" }),
      makeRow({ "Conversation ID": "2", "Agent Name": "Aya", "Agent Email": "aya@test.com", "Number of messages sent by the agent": "5" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.agentBreakdown).toHaveLength(1);
    expect(stats.agentBreakdown[0].agentName).toBe("Aya");
    expect(stats.agentBreakdown[0].conversationCount).toBe(2);
    expect(stats.agentBreakdown[0].totalMessagesFromAgent).toBe(15);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/basic-stats.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement basic-stats.ts**

Create `packages/eval-lib/src/data-analysis/basic-stats.ts`:

```typescript
import type { BasicStats, AgentStats } from "./types.js";

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute aggregate statistics from a stream of CSV rows.
 * Does not parse transcripts — only uses metadata columns.
 */
export async function computeBasicStats(
  rows: AsyncIterable<Record<string, string>>
): Promise<BasicStats> {
  let totalConversations = 0;
  let withUser = 0;
  let withoutUser = 0;
  const visitorIds = new Set<string>();
  const agentIds = new Set<string>();
  const statusCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const agentMap = new Map<string, AgentStats>();
  const visitorMsgCounts: number[] = [];
  const agentMsgCounts: number[] = [];
  const durations: number[] = [];
  let earliestStart = "";
  let latestStart = "";

  for await (const row of rows) {
    totalConversations++;

    const visitorMsgs = parseInt(row["Number of messages sent by the visitor"] || "0", 10);
    const agentMsgs = parseInt(row["Number of messages sent by the agent"] || "0", 10);
    const duration = parseInt(row["Total Conversation duration in Seconds"] || "0", 10);

    if (visitorMsgs > 0) withUser++;
    else withoutUser++;

    visitorIds.add(row["Visitor ID"]);
    agentIds.add(row["Agent ID"]);

    const status = row["Status"] || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const labels = (row["Labels"] || "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const label of labels) {
      labelCounts[label] = (labelCounts[label] || 0) + 1;
    }

    const agentKey = row["Agent ID"];
    const existing = agentMap.get(agentKey);
    if (existing) {
      existing.conversationCount++;
      existing.totalMessagesFromAgent += agentMsgs;
    } else {
      agentMap.set(agentKey, {
        agentName: row["Agent Name"] || "",
        agentEmail: row["Agent Email"] || "",
        conversationCount: 1,
        totalMessagesFromAgent: agentMsgs,
      });
    }

    visitorMsgCounts.push(visitorMsgs);
    agentMsgCounts.push(agentMsgs);
    durations.push(duration);

    const startDate = row["Start Date"] || "";
    if (!earliestStart || startDate < earliestStart) earliestStart = startDate;
    if (!latestStart || startDate > latestStart) latestStart = startDate;
  }

  visitorMsgCounts.sort((a, b) => a - b);
  agentMsgCounts.sort((a, b) => a - b);
  durations.sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  return {
    source: "",
    generatedAt: new Date().toISOString(),
    totalConversations,
    conversationsWithUserMessages: withUser,
    conversationsWithoutUserMessages: withoutUser,
    uniqueVisitors: visitorIds.size,
    uniqueAgents: agentIds.size,
    statusBreakdown: statusCounts,
    labelBreakdown: labelCounts,
    agentBreakdown: Array.from(agentMap.values()).sort(
      (a, b) => b.conversationCount - a.conversationCount
    ),
    visitorStats: {
      avgMessagesPerConversation: Math.round(avg(visitorMsgCounts) * 100) / 100,
      medianMessagesPerConversation: median(visitorMsgCounts),
    },
    agentStats: {
      avgMessagesPerConversation: Math.round(avg(agentMsgCounts) * 100) / 100,
      medianMessagesPerConversation: median(agentMsgCounts),
    },
    durationStats: {
      avgDurationSeconds: Math.round(avg(durations)),
      medianDurationSeconds: median(durations),
      minDurationSeconds: durations[0] ?? 0,
      maxDurationSeconds: durations[durations.length - 1] ?? 0,
    },
    timeRange: {
      earliestStart,
      latestStart,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/basic-stats.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/basic-stats.ts packages/eval-lib/tests/unit/data-analysis/basic-stats.test.ts
git commit -m "feat(data-analysis): add basic stats calculator with TDD tests"
```

---

## Task 6: CLI Runners (run-stats.ts and run-parse.ts)

**Files:**
- Create: `packages/eval-lib/src/data-analysis/run-stats.ts`
- Create: `packages/eval-lib/src/data-analysis/run-parse.ts`

- [ ] **Step 1: Implement run-stats.ts**

Create `packages/eval-lib/src/data-analysis/run-stats.ts`:

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseCSV, parseCLIArgs } from "./csv-parser.js";
import { computeBasicStats } from "./basic-stats.js";

async function main() {
  const { input, output } = parseCLIArgs(process.argv);

  console.error(`[stats] Reading CSV: ${input}`);
  const stats = await computeBasicStats(parseCSV(input));
  stats.source = basename(input);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(stats, null, 2));
  console.error(`[stats] Written to: ${output}`);
  console.error(`[stats] ${stats.totalConversations} conversations, ${stats.uniqueVisitors} visitors, ${stats.uniqueAgents} agents`);
}

main().catch((err) => {
  console.error("[stats] Error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Implement run-parse.ts**

Create `packages/eval-lib/src/data-analysis/run-parse.ts`:

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseCSV, parseCLIArgs } from "./csv-parser.js";
import { parseTranscript } from "./transcript-parser.js";
import type { RawConversation, RawTranscriptsFile } from "./types.js";

async function main() {
  const { input, output } = parseCLIArgs(process.argv);

  console.error(`[parse] Reading CSV: ${input}`);
  const conversations: RawConversation[] = [];
  let count = 0;

  for await (const row of parseCSV(input)) {
    count++;
    if (count % 5000 === 0) console.error(`[parse] Processed ${count} rows...`);

    const messages = parseTranscript(row["Transcript"] || "");
    const labels = (row["Labels"] || "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    conversations.push({
      conversationId: row["Conversation ID"] || "",
      visitorId: row["Visitor ID"] || "",
      visitorName: row["Visitor Name"] || "",
      visitorPhone: row["Visitor Phone"] || "",
      visitorEmail: row["Visitor Email"] || "",
      agentId: row["Agent ID"] || "",
      agentName: row["Agent Name"] || "",
      agentEmail: row["Agent Email"] || "",
      inbox: row["Inbox"] || "",
      labels,
      status: row["Status"] || "",
      messages,
      metadata: {
        messageCountVisitor: parseInt(row["Number of messages sent by the visitor"] || "0", 10),
        messageCountAgent: parseInt(row["Number of messages sent by the agent"] || "0", 10),
        totalDurationSeconds: parseInt(row["Total Conversation duration in Seconds"] || "0", 10),
        startDate: row["Start Date"] || "",
        startTime: row["Start Time"] || "",
        replyDate: row["Reply Date"] || "",
        replyTime: row["Reply Time"] || "",
        lastActivityDate: row["Last Activity Date"] || "",
        lastActivityTime: row["Last Activity Time"] || "",
      },
    });
  }

  const file: RawTranscriptsFile = {
    source: basename(input),
    generatedAt: new Date().toISOString(),
    totalConversations: conversations.length,
    conversations,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(file, null, 2));
  console.error(`[parse] Written ${conversations.length} conversations to: ${output}`);
}

main().catch((err) => {
  console.error("[parse] Error:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke test run-stats.ts with actual CSV**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && npx tsx packages/eval-lib/src/data-analysis/run-stats.ts --input "data/[2] VFQ - Telesales Human Livechat Conversations - 1st Jan 2026 - 31st Mar 2026.csv" --output data/output/basic-stats-q1-2026.json
```

Expected: Prints stats summary to stderr, writes JSON to `data/output/basic-stats-q1-2026.json`.

- [ ] **Step 4: Smoke test run-parse.ts with actual CSV (small sample — verify first 5 conversations)**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && npx tsx packages/eval-lib/src/data-analysis/run-parse.ts --input "data/[2] VFQ - Telesales Human Livechat Conversations - 1st Jan 2026 - 31st Mar 2026.csv" --output data/output/raw-transcripts-q1-2026.json
```

Expected: Writes JSON with all conversations. Verify with:

```bash
node -e "const d = require('./data/output/raw-transcripts-q1-2026.json'); console.log('Total:', d.totalConversations); console.log('First:', d.conversations[0].conversationId, d.conversations[0].messages.length, 'msgs')"
```

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/run-stats.ts packages/eval-lib/src/data-analysis/run-parse.ts
git commit -m "feat(data-analysis): add CLI runners for stats and transcript parsing"
```

---

## Task 7: Claude Client

**Files:**
- Create: `packages/eval-lib/src/data-analysis/claude-client.ts`

- [ ] **Step 1: Implement claude-client.ts**

Create `packages/eval-lib/src/data-analysis/claude-client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type {
  RawMessage,
  LLMExtractionResult,
  MicrotopicType,
  ExtractedInfo,
} from "./types.js";

const SYSTEM_PROMPT = `You are analyzing customer support chat transcripts from a telecom company (Vodafone Qatar).

Your task is to segment the conversation into microtopics and classify each one. You will receive messages with their IDs. Return ONLY message IDs and classifications — do NOT reproduce message text.

Conversations may be in English, Arabic, or a mix of both. Classify based on the semantic content regardless of language.

Microtopic types:
- identity_info: User shares personal information (name, phone, email, address, QID) or agent asks for/confirms it
- question: User asks a factual question about products, services, pricing, plans, coverage, features, etc.
- request: User makes a request, negotiation, or states a preference (e.g., "I want X", "Can you give me Y", "I need a discount")
- confirmation: Simple acknowledgments, yes/no responses, or brief confirmations between user and agent
- greeting: Hello/welcome exchanges
- closing: Thank you/goodbye/session-end exchanges
- uncategorized: Anything that doesn't clearly fit the above

Rules:
1. Every message ID from the input MUST appear in exactly one microtopic
2. Message IDs within each exchange must be in ascending order
3. Each microtopic has "exchanges". The "primary" exchange contains the core interaction. If the agent then asks a follow-up that continues the same topic, those messages go in a "follow_up" exchange.
4. Merge adjacent identity_info interactions into one microtopic when they flow naturally (e.g., agent asks for name, then phone, then address)
5. For identity_info microtopics, include an "extracted" array with structured data (type + value)
6. When a message is ambiguous, prefer the more specific type over "uncategorized"
7. A single message from the agent (like a greeting or closing template) can be its own microtopic`;

const TOOL_SCHEMA = {
  name: "classify_microtopics",
  description: "Classify conversation messages into microtopics",
  input_schema: {
    type: "object" as const,
    properties: {
      microtopics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "identity_info",
                "question",
                "request",
                "confirmation",
                "greeting",
                "closing",
                "uncategorized",
              ],
            },
            exchanges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", enum: ["primary", "follow_up"] },
                  messageIds: { type: "array", items: { type: "number" } },
                },
                required: ["label", "messageIds"],
              },
            },
            extracted: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  value: { type: "string" },
                },
                required: ["type", "value"],
              },
            },
          },
          required: ["type", "exchanges"],
        },
      },
    },
    required: ["microtopics"],
  },
};

export function createClaudeClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set."
    );
  }
  return new Anthropic({ apiKey: key });
}

/**
 * Send a conversation's messages to Claude for microtopic classification.
 * Returns ID-only results — no text reproduction.
 */
export async function classifyConversation(
  client: Anthropic,
  messages: RawMessage[],
  retries = 3
): Promise<LLMExtractionResult> {
  const userContent = `Messages:\n${JSON.stringify(
    messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
  )}\n\nClassify these messages into microtopics using the classify_microtopics tool.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "classify_microtopics" },
        messages: [{ role: "user", content: userContent }],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in response");
      }

      return toolBlock.input as LLMExtractionResult;
    } catch (err: any) {
      if (attempt < retries && err?.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.error(`[claude] Rate limited, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/eval-lib/src/data-analysis/claude-client.ts
git commit -m "feat(data-analysis): add Claude client with tool-use for microtopic classification"
```

---

## Task 8: Microtopic Extractor (TDD)

**Files:**
- Create: `packages/eval-lib/tests/unit/data-analysis/microtopic-extractor.test.ts`
- Create: `packages/eval-lib/src/data-analysis/microtopic-extractor.ts`

- [ ] **Step 1: Write failing tests for deterministic phases (A + C)**

Create `packages/eval-lib/tests/unit/data-analysis/microtopic-extractor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  preprocessConversation,
  assembleConversation,
  isSystemMessage,
} from "../../../src/data-analysis/microtopic-extractor.js";
import type { RawConversation, LLMExtractionResult } from "../../../src/data-analysis/types.js";

function makeConversation(overrides: Partial<RawConversation> = {}): RawConversation {
  return {
    conversationId: "1",
    visitorId: "v1",
    visitorName: "Test",
    visitorPhone: "+123",
    visitorEmail: "",
    agentId: "a1",
    agentName: "Agent",
    agentEmail: "a@test.com",
    inbox: "Test",
    labels: ["language_english"],
    status: "Resolved",
    messages: [
      { id: 1, role: "workflow_input", text: "Continue in English, -No Input-, New Postpaid Plan, English," },
      { id: 2, role: "workflow_input", text: "Assigned to Agent by Admin" },
      { id: 3, role: "user", text: "Hello" },
      { id: 4, role: "human_agent", text: "Hi there!" },
      { id: 5, role: "workflow_input", text: "Conversation was marked resolved by Agent" },
    ],
    metadata: {
      messageCountVisitor: 1,
      messageCountAgent: 1,
      totalDurationSeconds: 600,
      startDate: "01/01/2026",
      startTime: "12:00:00 AM",
      replyDate: "01/01/2026",
      replyTime: "12:01:00 AM",
      lastActivityDate: "01/01/2026",
      lastActivityTime: "12:10:00 AM",
    },
    ...overrides,
  };
}

describe("isSystemMessage", () => {
  it("should identify assignment messages", () => {
    expect(isSystemMessage("Assigned to John by Admin")).toBe(true);
  });

  it("should identify self-assignment messages", () => {
    expect(isSystemMessage("John self-assigned this conversation")).toBe(true);
  });

  it("should identify unassignment messages", () => {
    expect(isSystemMessage("Conversation unassigned by John")).toBe(true);
  });

  it("should identify resolution messages", () => {
    expect(isSystemMessage("Conversation was marked resolved by John")).toBe(true);
  });

  it("should identify label addition messages", () => {
    expect(isSystemMessage("John added campaign_mobile, language_english")).toBe(true);
  });

  it("should NOT match regular user messages", () => {
    expect(isSystemMessage("Hello, I need help")).toBe(false);
  });
});

describe("preprocessConversation", () => {
  it("should extract botFlowInput from first workflow message", () => {
    const conv = makeConversation();
    const result = preprocessConversation(conv);
    expect(result.botFlowInput).toBeDefined();
    expect(result.botFlowInput!.intent).toBe("New Postpaid Plan");
    expect(result.botFlowInput!.language).toBe("English");
    expect(result.botFlowInput!.messageIds).toEqual([1]);
  });

  it("should separate system messages from LLM input", () => {
    const conv = makeConversation();
    const result = preprocessConversation(conv);
    // System messages: id 2 (assignment), id 5 (resolution)
    expect(result.systemMessageIds).toEqual(new Set([2, 5]));
    // LLM input: only user + agent messages (id 3, 4)
    expect(result.llmInputMessages.map((m) => m.id)).toEqual([3, 4]);
  });

  it("should skip LLM when no user/agent messages", () => {
    const conv = makeConversation({
      messages: [
        { id: 1, role: "workflow_input", text: "Assigned to Agent by Admin" },
        { id: 2, role: "workflow_input", text: "Conversation was marked resolved by Agent" },
      ],
    });
    const result = preprocessConversation(conv);
    expect(result.llmInputMessages).toHaveLength(0);
    expect(result.skipLLM).toBe(true);
  });
});

describe("assembleConversation", () => {
  it("should merge LLM results with system messages in ID order", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3, 4] }],
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    expect(result.conversationId).toBe("1");
    expect(result.language).toBe("English");
    expect(result.botFlowInput).toBeDefined();

    // Should have: uncategorized(2), greeting(3,4), uncategorized(5)
    expect(result.microtopics).toHaveLength(3);
    expect(result.microtopics[0].type).toBe("uncategorized");
    expect(result.microtopics[0].exchanges[0].messages[0].id).toBe(2);
    expect(result.microtopics[1].type).toBe("greeting");
    expect(result.microtopics[1].exchanges[0].messages.map((m) => m.id)).toEqual([3, 4]);
    expect(result.microtopics[2].type).toBe("uncategorized");
    expect(result.microtopics[2].exchanges[0].messages[0].id).toBe(5);
  });

  it("should add missing IDs as uncategorized", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    // LLM only returns message 3, missing message 4
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3] }],
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    // Message 4 should appear as uncategorized
    const allIds = result.microtopics.flatMap((m) =>
      m.exchanges.flatMap((e) => e.messages.map((msg) => msg.id))
    );
    expect(allIds).toContain(4);
  });

  it("should strip hallucinated IDs", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3, 4, 999] }], // 999 doesn't exist
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    const allIds = result.microtopics.flatMap((m) =>
      m.exchanges.flatMap((e) => e.messages.map((msg) => msg.id))
    );
    expect(allIds).not.toContain(999);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/microtopic-extractor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement microtopic-extractor.ts**

Create `packages/eval-lib/src/data-analysis/microtopic-extractor.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { parseBotFlowInput } from "./transcript-parser.js";
import { classifyConversation } from "./claude-client.js";
import type {
  RawConversation,
  RawMessage,
  BotFlowInput,
  ConversationMicrotopics,
  MicrotopicsFile,
  Microtopic,
  MicrotopicMessage,
  LLMExtractionResult,
} from "./types.js";

// ── System message patterns ──
const SYSTEM_PATTERNS = [
  /^Assigned to .+ by .+$/,
  /^Conversation unassigned by .+$/,
  /.+ self-assigned this conversation$/,
  /.+ added .+$/,
  /^Conversation was marked resolved by .+$/,
];

export function isSystemMessage(text: string): boolean {
  return SYSTEM_PATTERNS.some((p) => p.test(text));
}

// ── Phase A: Preprocessing ──
export interface PreprocessResult {
  botFlowInput?: BotFlowInput;
  systemMessageIds: Set<number>;
  llmInputMessages: RawMessage[];
  skipLLM: boolean;
}

export function preprocessConversation(conv: RawConversation): PreprocessResult {
  let botFlowInput: BotFlowInput | undefined;
  const systemMessageIds = new Set<number>();
  const llmInputMessages: RawMessage[] = [];

  for (let i = 0; i < conv.messages.length; i++) {
    const msg = conv.messages[i];

    // Detect bot flow input (first workflow_input message with comma pattern)
    if (i === 0 && msg.role === "workflow_input") {
      const parsed = parseBotFlowInput(msg.text);
      if (parsed.language !== "unknown" || parsed.intent !== "unknown") {
        botFlowInput = { ...parsed, messageIds: [msg.id] };
        continue; // Exclude from LLM input
      }
    }

    // Classify system messages
    if (msg.role === "workflow_input" && isSystemMessage(msg.text)) {
      systemMessageIds.add(msg.id);
      continue; // Exclude from LLM input
    }

    // Bot flow input that wasn't detected above — still a workflow message
    if (msg.role === "workflow_input") {
      // If it's the first message and we didn't parse it as bot flow, treat as system
      if (i === 0) {
        botFlowInput = { ...parseBotFlowInput(msg.text), messageIds: [msg.id] };
        continue;
      }
      systemMessageIds.add(msg.id);
      continue;
    }

    llmInputMessages.push(msg);
  }

  return {
    botFlowInput,
    systemMessageIds,
    llmInputMessages,
    skipLLM: llmInputMessages.length === 0,
  };
}

// ── Phase C: Assembly ──
function detectLanguage(conv: RawConversation): string {
  for (const label of conv.labels) {
    if (label === "language_english") return "English";
    if (label === "language_arabic") return "Arabic";
  }
  return "unknown";
}

export function assembleConversation(
  conv: RawConversation,
  preprocess: PreprocessResult,
  llmResult: LLMExtractionResult
): ConversationMicrotopics {
  const messageMap = new Map<number, RawMessage>();
  for (const msg of conv.messages) {
    messageMap.set(msg.id, msg);
  }

  // Track which IDs the LLM claimed
  const llmClaimedIds = new Set<number>();
  const validMicrotopics: { type: string; exchanges: { label: string; messageIds: number[] }[]; extracted?: any[] }[] = [];

  for (const mt of llmResult.microtopics) {
    const validExchanges: { label: string; messageIds: number[] }[] = [];
    for (const ex of mt.exchanges) {
      const validIds = ex.messageIds.filter((id) => {
        if (!messageMap.has(id)) return false; // Strip hallucinated IDs
        if (llmClaimedIds.has(id)) return false; // Strip duplicates
        llmClaimedIds.add(id);
        return true;
      });
      if (validIds.length > 0) {
        validExchanges.push({ label: ex.label, messageIds: validIds });
      }
    }
    if (validExchanges.length > 0) {
      validMicrotopics.push({
        type: mt.type,
        exchanges: validExchanges,
        extracted: mt.extracted,
      });
    }
  }

  // Find missing LLM input IDs → append as uncategorized
  const missingIds = preprocess.llmInputMessages
    .map((m) => m.id)
    .filter((id) => !llmClaimedIds.has(id));

  if (missingIds.length > 0) {
    validMicrotopics.push({
      type: "uncategorized",
      exchanges: [{ label: "primary", messageIds: missingIds }],
    });
  }

  // Build system message microtopics (one per system message)
  const systemMicrotopics: { minId: number; microtopic: Microtopic }[] = [];
  for (const sysId of preprocess.systemMessageIds) {
    const msg = messageMap.get(sysId)!;
    systemMicrotopics.push({
      minId: sysId,
      microtopic: {
        type: "uncategorized",
        exchanges: [
          {
            label: "primary",
            messages: [{ id: msg.id, role: msg.role, text: msg.text }],
          },
        ],
      },
    });
  }

  // Build LLM microtopics with full messages
  const llmMicrotopics: { minId: number; microtopic: Microtopic }[] = [];
  for (const vmt of validMicrotopics) {
    const exchanges = vmt.exchanges.map((ex) => ({
      label: ex.label as "primary" | "follow_up",
      messages: ex.messageIds.map((id) => {
        const msg = messageMap.get(id)!;
        return { id: msg.id, role: msg.role, text: msg.text } as MicrotopicMessage;
      }),
    }));

    const minId = Math.min(...vmt.exchanges.flatMap((e) => e.messageIds));
    llmMicrotopics.push({
      minId,
      microtopic: {
        type: vmt.type as Microtopic["type"],
        exchanges,
        ...(vmt.extracted && vmt.extracted.length > 0 ? { extracted: vmt.extracted } : {}),
      },
    });
  }

  // Merge and sort by lowest message ID
  const allMicrotopics = [...systemMicrotopics, ...llmMicrotopics];
  allMicrotopics.sort((a, b) => a.minId - b.minId);

  return {
    conversationId: conv.conversationId,
    language: detectLanguage(conv),
    botFlowInput: preprocess.botFlowInput,
    microtopics: allMicrotopics.map((m) => m.microtopic),
  };
}

// ── Main orchestrator ──
export async function extractMicrotopics(
  conversations: RawConversation[],
  options: {
    claudeClient: Anthropic;
    source: string;
    limit?: number;
    concurrency?: number;
  }
): Promise<MicrotopicsFile> {
  const { claudeClient, source, limit, concurrency = 10 } = options;
  const toProcess = limit ? conversations.slice(0, limit) : conversations;

  const results: ConversationMicrotopics[] = [];
  const failures: string[] = [];
  let processed = 0;

  // Process in batches
  for (let i = 0; i < toProcess.length; i += concurrency) {
    const batch = toProcess.slice(i, i + concurrency);
    const promises = batch.map(async (conv) => {
      const preprocess = preprocessConversation(conv);

      if (preprocess.skipLLM) {
        // All messages become uncategorized
        return assembleConversation(conv, preprocess, { microtopics: [] });
      }

      try {
        const llmResult = await classifyConversation(
          claudeClient,
          preprocess.llmInputMessages
        );
        return assembleConversation(conv, preprocess, llmResult);
      } catch (err: any) {
        console.error(
          `[microtopics] Failed for conversation ${conv.conversationId}: ${err.message}`
        );
        failures.push(conv.conversationId);
        // Fallback: all messages uncategorized
        return assembleConversation(conv, preprocess, { microtopics: [] });
      }
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    processed += batch.length;
    console.error(`[microtopics] Processed ${processed}/${toProcess.length}`);
  }

  return {
    source,
    generatedAt: new Date().toISOString(),
    model: "claude-sonnet-4-6",
    totalConversations: conversations.length,
    processedConversations: toProcess.length,
    failures,
    conversations: results,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/microtopic-extractor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/microtopic-extractor.ts packages/eval-lib/tests/unit/data-analysis/microtopic-extractor.test.ts
git commit -m "feat(data-analysis): add microtopic extractor with TDD tests for phases A+C"
```

---

## Task 9: CLI Runner for Microtopics (run-microtopics.ts)

**Files:**
- Create: `packages/eval-lib/src/data-analysis/run-microtopics.ts`

- [ ] **Step 1: Implement run-microtopics.ts**

Create `packages/eval-lib/src/data-analysis/run-microtopics.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseCLIArgs } from "./csv-parser.js";
import { createClaudeClient } from "./claude-client.js";
import { extractMicrotopics } from "./microtopic-extractor.js";
import type { RawTranscriptsFile } from "./types.js";

async function main() {
  const { input, output, limit, concurrency } = parseCLIArgs(process.argv);

  console.error(`[microtopics] Reading raw transcripts: ${input}`);
  const rawFile: RawTranscriptsFile = JSON.parse(readFileSync(input, "utf-8"));

  console.error(
    `[microtopics] ${rawFile.totalConversations} total conversations, processing ${limit ?? "all"}`
  );

  const client = createClaudeClient();
  const result = await extractMicrotopics(rawFile.conversations, {
    claudeClient: client,
    source: rawFile.source,
    limit,
    concurrency: concurrency ?? 10,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.error(
    `[microtopics] Written ${result.processedConversations} conversations to: ${output}`
  );
  if (result.failures.length > 0) {
    console.error(
      `[microtopics] ${result.failures.length} failures: ${result.failures.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error("[microtopics] Error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Update index.ts exports**

Verify `packages/eval-lib/src/data-analysis/index.ts` has all the exports. It should already be correct from Task 2. If `preprocessConversation`, `assembleConversation`, and `isSystemMessage` need to be exported for testing, they're imported directly in tests via relative path, so no change needed.

- [ ] **Step 3: Build and verify**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 4: Run all data-analysis tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/run-microtopics.ts packages/eval-lib/src/data-analysis/index.ts
git commit -m "feat(data-analysis): add CLI runner for microtopic extraction"
```

---

## Task 10: End-to-End Smoke Test with Real Data

**Files:** None (testing only)

- [ ] **Step 1: Run the full pipeline on the smaller CSV file**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith

# Step 1: Stats
npx tsx packages/eval-lib/src/data-analysis/run-stats.ts \
  --input "data/[2] VFQ - Telesales Human Livechat Conversations - 1st Jan 2026 - 31st Mar 2026.csv" \
  --output data/output/basic-stats-q1-2026.json

# Step 2: Parse transcripts
npx tsx packages/eval-lib/src/data-analysis/run-parse.ts \
  --input "data/[2] VFQ - Telesales Human Livechat Conversations - 1st Jan 2026 - 31st Mar 2026.csv" \
  --output data/output/raw-transcripts-q1-2026.json

# Step 3: Extract microtopics (first 10 conversations only for quick smoke test)
ANTHROPIC_API_KEY=<your-key> npx tsx packages/eval-lib/src/data-analysis/run-microtopics.ts \
  --input data/output/raw-transcripts-q1-2026.json \
  --output data/output/microtopics-q1-2026.json \
  --limit 10 \
  --concurrency 5
```

- [ ] **Step 2: Verify output quality**

```bash
node -e "
const mt = require('./data/output/microtopics-q1-2026.json');
console.log('Processed:', mt.processedConversations);
console.log('Failures:', mt.failures.length);
const conv = mt.conversations[0];
console.log('Conv:', conv.conversationId, 'Language:', conv.language);
console.log('Bot flow:', conv.botFlowInput?.intent);
console.log('Microtopics:', conv.microtopics.length);
conv.microtopics.forEach((m, i) => {
  const msgCount = m.exchanges.reduce((s, e) => s + e.messages.length, 0);
  console.log('  ' + i + ': ' + m.type + ' (' + msgCount + ' msgs, ' + m.exchanges.length + ' exchanges)');
});
"
```

Expected: Structured output with classified microtopics. Verify questions/requests are correctly identified.

- [ ] **Step 3: Commit a checkpoint**

```bash
git add -A && git commit -m "chore: eval-lib data-analysis module complete — all scripts working"
```

---

## Task 11: Frontend — Types and LivechatView Shell

> **PREREQUISITE:** Tasks 1-9 must be complete and `pnpm build` must pass before starting frontend tasks. The frontend imports types from `rag-evaluation-system/data-analysis`, which requires the eval-lib to be built first. Run `pnpm build` at the repo root before proceeding.

**Files:**
- Create: `packages/frontend/src/components/livechat/types.ts`
- Create: `packages/frontend/src/components/livechat/LivechatView.tsx`
- Create: `packages/frontend/src/components/livechat/TabBar.tsx`
- Modify: `packages/frontend/src/app/kb/page.tsx`

- [ ] **Step 1: Create frontend types**

Create `packages/frontend/src/components/livechat/types.ts`:

```typescript
import type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "transcripts" | "microtopics";

export interface UploadEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  status: "pending" | "parsing" | "analyzing" | "ready" | "error";
  conversationCount?: number;
  error?: string;
  outputFiles?: {
    rawTranscripts: string;
    microtopics: string;
    basicStats: string;
  };
}

export interface LoadedData {
  rawTranscripts: RawTranscriptsFile;
  microtopics: MicrotopicsFile;
  basicStats: BasicStats;
}

export interface MicrotopicByTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  microtopic: Microtopic;
}

export type MicrotopicsByType = Map<MicrotopicType, MicrotopicByTypeItem[]>;

export type { RawTranscriptsFile, MicrotopicsFile, BasicStats, MicrotopicType, Microtopic };
```

- [ ] **Step 2: Create TabBar component**

Create `packages/frontend/src/components/livechat/TabBar.tsx`:

```typescript
"use client";

import type { LivechatTab } from "./types";

const TABS: { key: LivechatTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "transcripts", label: "Transcripts" },
  { key: "microtopics", label: "Microtopics" },
];

export function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: LivechatTab;
  onTabChange: (tab: LivechatTab) => void;
}) {
  return (
    <div className="flex border-b border-border bg-bg-elevated">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === tab.key
              ? "border-b-2 border-accent text-accent"
              : "text-text-dim hover:text-text"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create LivechatView shell**

Create `packages/frontend/src/components/livechat/LivechatView.tsx`:

```typescript
"use client";

import { useState } from "react";
import { TabBar } from "./TabBar";
import type { LivechatTab, UploadEntry, LoadedData } from "./types";

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar */}
      <div className="w-[180px] border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
          <button className="w-full text-xs bg-accent-dim text-accent-bright rounded px-2 py-1.5 hover:bg-accent-dim/80 transition-colors">
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {uploads.length === 0 && (
            <div className="text-text-dim text-xs p-3 text-center">
              No uploads yet
            </div>
          )}
          {uploads.map((upload) => (
            <button
              key={upload.id}
              onClick={() => setSelectedUploadId(upload.id)}
              className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
                selectedUploadId === upload.id
                  ? "bg-bg-surface border-l-2 border-accent text-accent"
                  : "text-text-muted hover:bg-bg-hover"
              }`}
            >
              <div className="truncate">{upload.filename}</div>
              <div className="text-text-dim text-[10px] mt-0.5">
                {upload.conversationCount
                  ? `${upload.conversationCount.toLocaleString()} convos`
                  : upload.status}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 overflow-hidden">
          {activeTab === "stats" && (
            <div className="p-4 text-text-dim text-xs">
              Stats tab — select an upload to view
            </div>
          )}
          {activeTab === "transcripts" && (
            <div className="p-4 text-text-dim text-xs">
              Transcripts tab — select an upload to view
            </div>
          )}
          {activeTab === "microtopics" && (
            <div className="p-4 text-text-dim text-xs">
              Microtopics tab — select an upload to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add icon rail to KB page**

In `packages/frontend/src/app/kb/page.tsx`, modify the `KBPageContent` function. Add a state variable for the active mode and wrap the existing content in the icon rail layout.

Add at the top of `KBPageContent` (after existing state declarations around line 26):

```typescript
const [kbMode, setKbMode] = useState<"documents" | "livechat">("documents");
```

Add the import at the top of the file:

```typescript
import { LivechatView } from "@/components/livechat/LivechatView";
```

Replace the return statement's outermost `<div>` structure. Wrap the existing content after the `<Header>` in a flex container with the icon rail:

```tsx
return (
  <div className="flex flex-col h-screen">
    <Header mode="kb" kbId={selectedKbId} />

    <div className="flex flex-1 overflow-hidden">
      {/* Icon Rail */}
      <div className="w-9 bg-bg-elevated border-r border-border flex flex-col items-center pt-3 gap-2">
        <button
          onClick={() => setKbMode("documents")}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
            kbMode === "documents"
              ? "bg-accent-dim text-accent-bright border-l-2 border-accent"
              : "text-text-dim hover:text-text-muted"
          }`}
          title="Documents"
        >
          📄
        </button>
        <button
          onClick={() => setKbMode("livechat")}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
            kbMode === "livechat"
              ? "bg-accent-dim text-accent-bright border-l-2 border-accent"
              : "text-text-dim hover:text-text-muted"
          }`}
          title="Livechat Transcripts"
        >
          💬
        </button>
      </div>

      {/* Content */}
      {kbMode === "livechat" ? (
        <LivechatView />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ... existing KB content (everything after Header) ... */}
        </div>
      )}
    </div>
  </div>
);
```

The existing KB content (KB Selection bar, document list, document viewer) goes inside the `<div className="flex-1 flex flex-col overflow-hidden">` when `kbMode === "documents"`.

- [ ] **Step 5: Verify frontend builds**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build && pnpm -C packages/frontend build
```

Expected: Both builds succeed.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/livechat/ packages/frontend/src/app/kb/page.tsx
git commit -m "feat(frontend): add livechat view shell with icon rail in KB page"
```

---

## Task 12: Frontend — Upload API Routes

**Files:**
- Create: `packages/frontend/src/app/api/livechat/upload/route.ts`
- Create: `packages/frontend/src/app/api/livechat/manifest/route.ts`
- Create: `packages/frontend/src/app/api/livechat/data/[id]/route.ts`

- [ ] **Step 1: Create upload route**

Create `packages/frontend/src/app/api/livechat/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

// process.cwd() in Next.js dev = packages/frontend, so ../../data = repo root/data
// In production, use an env var DATA_DIR instead
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "..", "..", "data");
const UPLOADS_DIR = join(DATA_DIR, "uploads");
const OUTPUT_DIR = join(DATA_DIR, "output");
const MANIFEST_PATH = join(UPLOADS_DIR, "manifest.json");

interface ManifestEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  status: string;
  conversationCount?: number;
  error?: string;
  outputFiles?: {
    rawTranscripts: string;
    microtopics: string;
    basicStats: string;
  };
}

function readManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function writeManifest(entries: ManifestEntry[]) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const id = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50)}`;
    mkdirSync(UPLOADS_DIR, { recursive: true });
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const csvPath = join(UPLOADS_DIR, `${id}.csv`);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(csvPath, buffer);

    const manifest = readManifest();
    const entry: ManifestEntry = {
      id,
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      status: "parsing",
    };
    manifest.push(entry);
    writeManifest(manifest);

    // Run processing pipeline in background (non-blocking)
    // In production this would be a job queue; for now, run synchronously
    try {
      const evalLibDir = join(process.cwd(), "..", "eval-lib");
      const statsPath = join(OUTPUT_DIR, `basic-stats-${id}.json`);
      const rawPath = join(OUTPUT_DIR, `raw-transcripts-${id}.json`);
      const mtPath = join(OUTPUT_DIR, `microtopics-${id}.json`);

      // Step 1+2: Parse + Stats (parallel via sequential exec for simplicity)
      execSync(
        `npx tsx src/data-analysis/run-stats.ts --input "${csvPath}" --output "${statsPath}"`,
        { cwd: evalLibDir, stdio: "pipe" }
      );
      execSync(
        `npx tsx src/data-analysis/run-parse.ts --input "${csvPath}" --output "${rawPath}"`,
        { cwd: evalLibDir, stdio: "pipe" }
      );

      // Read conversation count from raw transcripts
      const rawData = JSON.parse(readFileSync(rawPath, "utf-8"));
      entry.conversationCount = rawData.totalConversations;
      entry.status = "analyzing";
      writeManifest(manifest);

      // Step 3: Microtopics (limit 200)
      execSync(
        `npx tsx src/data-analysis/run-microtopics.ts --input "${rawPath}" --output "${mtPath}" --limit 200 --concurrency 10`,
        { cwd: evalLibDir, stdio: "pipe", timeout: 600000 }
      );

      entry.status = "ready";
      entry.outputFiles = {
        rawTranscripts: rawPath,
        microtopics: mtPath,
        basicStats: statsPath,
      };
      writeManifest(manifest);
    } catch (err: any) {
      entry.status = "error";
      entry.error = err.message;
      writeManifest(manifest);
    }

    return NextResponse.json({ id: entry.id, status: entry.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create manifest route**

Create `packages/frontend/src/app/api/livechat/manifest/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(process.cwd(), "..", "..", "data", "uploads", "manifest.json");

export async function GET() {
  if (!existsSync(MANIFEST_PATH)) {
    return NextResponse.json([]);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  return NextResponse.json(manifest);
}
```

- [ ] **Step 3: Create data serving route**

Create `packages/frontend/src/app/api/livechat/data/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(process.cwd(), "..", "..", "data", "uploads", "manifest.json");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type"); // "rawTranscripts" | "microtopics" | "basicStats"

  if (!type || !["rawTranscripts", "microtopics", "basicStats"].includes(type)) {
    return NextResponse.json({ error: "Missing or invalid type param" }, { status: 400 });
  }

  if (!existsSync(MANIFEST_PATH)) {
    return NextResponse.json({ error: "No manifest" }, { status: 404 });
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const entry = manifest.find((e: any) => e.id === id);

  if (!entry || entry.status !== "ready" || !entry.outputFiles) {
    return NextResponse.json({ error: "Upload not ready" }, { status: 404 });
  }

  const filePath = entry.outputFiles[type as keyof typeof entry.outputFiles];
  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/api/livechat/
git commit -m "feat(frontend): add livechat API routes for upload, manifest, and data serving"
```

---

## Task 13: Frontend — StatsTab Component

**Files:**
- Create: `packages/frontend/src/components/livechat/StatsTab.tsx`

- [ ] **Step 1: Implement StatsTab**

Create `packages/frontend/src/components/livechat/StatsTab.tsx`:

```typescript
"use client";

import type { BasicStats } from "./types";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg-surface rounded-md border border-border p-3">
      <div className="text-text-dim text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div className="text-accent text-lg font-semibold mt-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function StatsTab({ stats }: { stats: BasicStats | null }) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view stats
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Top row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Conversations" value={stats.totalConversations} />
        <StatCard label="With User Messages" value={stats.conversationsWithUserMessages} />
        <StatCard label="Unique Visitors" value={stats.uniqueVisitors} />
        <StatCard label="Unique Agents" value={stats.uniqueAgents} />
      </div>

      {/* Duration row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Avg Duration" value={formatDuration(stats.durationStats.avgDurationSeconds)} />
        <StatCard label="Median Duration" value={formatDuration(stats.durationStats.medianDurationSeconds)} />
        <StatCard label="Avg Msgs (Visitor)" value={stats.visitorStats.avgMessagesPerConversation} />
        <StatCard label="Avg Msgs (Agent)" value={stats.agentStats.avgMessagesPerConversation} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-bg-surface rounded-md border border-border p-3">
          <div className="text-text-muted text-xs mb-2">Top Agents</div>
          {stats.agentBreakdown.slice(0, 10).map((agent) => (
            <div
              key={agent.agentEmail}
              className="flex justify-between text-xs mb-1"
            >
              <span className="text-text truncate mr-2">{agent.agentName}</span>
              <span className="text-accent">{agent.conversationCount.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="bg-bg-surface rounded-md border border-border p-3">
          <div className="text-text-muted text-xs mb-2">Labels</div>
          {Object.entries(stats.labelBreakdown)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([label, count]) => (
              <div key={label} className="flex justify-between text-xs mb-1">
                <span className="text-text truncate mr-2">{label}</span>
                <span className="text-accent">{count.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/StatsTab.tsx
git commit -m "feat(frontend): add StatsTab component with dashboard cards"
```

---

## Task 14: Frontend — ChatBubble and ConversationList

**Files:**
- Create: `packages/frontend/src/components/livechat/ChatBubble.tsx`
- Create: `packages/frontend/src/components/livechat/ConversationList.tsx`

- [ ] **Step 1: Implement ChatBubble**

Create `packages/frontend/src/components/livechat/ChatBubble.tsx`:

```typescript
"use client";

import type { MessageRole } from "rag-evaluation-system/data-analysis";

export function ChatBubble({
  id,
  role,
  text,
  agentName,
}: {
  id: number;
  role: MessageRole;
  text: string;
  agentName?: string;
}) {
  if (role === "workflow_input") {
    return (
      <div className="text-center my-1">
        <span className="text-text-dim text-[10px] bg-bg-surface px-2 py-0.5 rounded-full">
          {text}
        </span>
      </div>
    );
  }

  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`max-w-[70%] px-2.5 py-1.5 text-xs whitespace-pre-wrap ${
          isUser
            ? "bg-accent-dim text-accent-bright rounded-lg rounded-br-sm"
            : "bg-bg-surface text-text border border-border rounded-lg rounded-bl-sm"
        }`}
      >
        <div
          className={`text-[9px] mb-0.5 ${
            isUser ? "text-accent-bright/50" : "text-text-dim"
          }`}
        >
          {isUser ? "User" : agentName ?? "Agent"} · #{id}
        </div>
        {text}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement ConversationList**

Create `packages/frontend/src/components/livechat/ConversationList.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { RawConversation } from "rag-evaluation-system/data-analysis";

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  renderBadges,
}: {
  conversations: RawConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderBadges?: (conv: RawConversation) => React.ReactNode;
}) {
  const [search, setSearch] = useState("");

  const filtered = conversations.filter((conv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      conv.visitorName.toLowerCase().includes(q) ||
      conv.conversationId.includes(q) ||
      conv.agentName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations..."
          className="w-full bg-bg-surface border border-border rounded px-2 py-1 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filtered.map((conv) => (
          <button
            key={conv.conversationId}
            onClick={() => onSelect(conv.conversationId)}
            className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
              selectedId === conv.conversationId
                ? "bg-bg-surface border-l-2 border-accent"
                : "hover:bg-bg-hover"
            }`}
          >
            <div className="flex justify-between">
              <span
                className={
                  selectedId === conv.conversationId
                    ? "text-accent"
                    : "text-text-muted"
                }
              >
                {conv.visitorName || "Unknown"}
              </span>
              <span className="text-text-dim text-[10px]">
                #{conv.conversationId}
              </span>
            </div>
            <div className="text-text-dim text-[10px] mt-0.5">
              {conv.agentName} · {conv.messages.length} msgs
            </div>
            {renderBadges && (
              <div className="mt-1">{renderBadges(conv)}</div>
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-text-dim text-xs p-3 text-center">
            No conversations found
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/ChatBubble.tsx packages/frontend/src/components/livechat/ConversationList.tsx
git commit -m "feat(frontend): add ChatBubble and ConversationList components"
```

---

## Task 15: Frontend — TranscriptsTab

**Files:**
- Create: `packages/frontend/src/components/livechat/TranscriptsTab.tsx`

- [ ] **Step 1: Implement TranscriptsTab**

Create `packages/frontend/src/components/livechat/TranscriptsTab.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import type { RawTranscriptsFile, RawConversation } from "rag-evaluation-system/data-analysis";
import { ConversationList } from "./ConversationList";
import { ChatBubble } from "./ChatBubble";

export function TranscriptsTab({
  data,
}: {
  data: RawTranscriptsFile | null;
}) {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const conversations = useMemo(() => {
    if (!data) return [];
    return data.conversations.filter(
      (c) => c.metadata.messageCountVisitor > 0
    );
  }, [data]);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.conversationId === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view transcripts
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation list */}
      <div className="w-[220px] border-r border-border">
        <ConversationList
          conversations={conversations}
          selectedId={selectedConvId}
          onSelect={setSelectedConvId}
        />
      </div>

      {/* Chat detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedConv ? (
          <>
            <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
              <div>
                <span className="text-text text-xs font-semibold">
                  {selectedConv.visitorName || "Unknown"}
                </span>
                <span className="text-text-dim text-[10px] ml-2">
                  #{selectedConv.conversationId} · {selectedConv.visitorPhone}
                </span>
              </div>
              <div className="flex gap-1">
                {selectedConv.status && (
                  <span className="text-[9px] text-text-muted bg-bg-surface border border-border rounded px-1.5 py-0.5">
                    {selectedConv.status}
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {selectedConv.messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  id={msg.id}
                  role={msg.role}
                  text={msg.text}
                  agentName={selectedConv.agentName}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            Select a conversation to view
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/TranscriptsTab.tsx
git commit -m "feat(frontend): add TranscriptsTab with chat bubble detail view"
```

---

## Task 16: Frontend — MicrotopicCard and ExportButton

**Files:**
- Create: `packages/frontend/src/components/livechat/MicrotopicCard.tsx`
- Create: `packages/frontend/src/components/livechat/ExportButton.tsx`

- [ ] **Step 1: Implement MicrotopicCard**

Create `packages/frontend/src/components/livechat/MicrotopicCard.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { Microtopic } from "rag-evaluation-system/data-analysis";
import { ChatBubble } from "./ChatBubble";

const TYPE_COLORS: Record<string, { badge: string; border: string }> = {
  question: { badge: "bg-accent-dim text-accent-bright", border: "border-accent" },
  request: { badge: "bg-[#818cf820] text-[#818cf8]", border: "border-[#818cf8]" },
  identity_info: { badge: "bg-[#fbbf2420] text-[#fbbf24]", border: "border-[#fbbf24]" },
  greeting: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  closing: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  confirmation: { badge: "bg-[#8888a020] text-text-muted", border: "border-border" },
  uncategorized: { badge: "bg-bg-surface text-text-dim", border: "border-border" },
};

export function MicrotopicCard({
  microtopic,
  agentName,
}: {
  microtopic: Microtopic;
  agentName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const colors = TYPE_COLORS[microtopic.type] ?? TYPE_COLORS.uncategorized;
  const msgCount = microtopic.exchanges.reduce(
    (s, e) => s + e.messages.length,
    0
  );

  // For uncategorized workflow messages, show compact inline
  if (
    microtopic.type === "uncategorized" &&
    microtopic.exchanges.every((e) =>
      e.messages.every((m) => m.role === "workflow_input")
    )
  ) {
    const text = microtopic.exchanges
      .flatMap((e) => e.messages)
      .map((m) => m.text)
      .join(" · ");
    return (
      <div className="text-center my-1">
        <span className="text-text-dim text-[9px]">{text}</span>
      </div>
    );
  }

  const previewText =
    microtopic.type === "identity_info" && microtopic.extracted?.length
      ? microtopic.extracted.map((e) => `${e.type}: ${e.value}`).join(" · ")
      : microtopic.exchanges[0]?.messages.find((m) => m.role === "user")?.text ??
        microtopic.exchanges[0]?.messages[0]?.text ??
        "";

  return (
    <div
      className={`bg-bg-surface rounded-md border ${
        expanded ? colors.border : "border-border"
      } mb-1`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-2.5 py-1.5 flex justify-between items-center"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-text-dim">{expanded ? "▾" : "▸"}</span>
          <span
            className={`text-[9px] px-1.5 py-0 rounded ${colors.badge}`}
          >
            {microtopic.type}
          </span>
          {!expanded && (
            <span className="text-text-muted text-xs truncate">
              {previewText}
            </span>
          )}
        </div>
        <span className="text-text-dim text-[10px] ml-2 whitespace-nowrap">
          {msgCount} msgs · {microtopic.exchanges.length} ex
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {microtopic.exchanges.map((exchange, i) => (
            <div
              key={i}
              className={
                i > 0 ? "border-t border-border/50" : ""
              }
            >
              <div className="px-2.5 pt-1.5 pb-0.5">
                <div className="text-text-dim text-[9px] uppercase tracking-wider mb-1">
                  {exchange.label}
                </div>
              </div>
              <div className="px-2.5 pb-2">
                {exchange.messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    id={msg.id}
                    role={msg.role}
                    text={msg.text}
                    agentName={agentName}
                  />
                ))}
              </div>
            </div>
          ))}
          {microtopic.extracted && microtopic.extracted.length > 0 && (
            <div className="px-2.5 py-1.5 border-t border-border/50 flex gap-1 flex-wrap">
              {microtopic.extracted.map((info, i) => (
                <span
                  key={i}
                  className="text-[9px] bg-bg-hover text-text-muted rounded px-1.5 py-0.5"
                >
                  {info.type}: {info.value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement ExportButton**

Create `packages/frontend/src/components/livechat/ExportButton.tsx`:

```typescript
"use client";

export function ExportButton({
  data,
  filename,
}: {
  data: unknown;
  filename: string;
}) {
  function handleExport() {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="text-[10px] text-text-muted hover:text-accent border border-border rounded px-2 py-0.5 transition-colors"
    >
      Export JSON
    </button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/MicrotopicCard.tsx packages/frontend/src/components/livechat/ExportButton.tsx
git commit -m "feat(frontend): add MicrotopicCard accordion and ExportButton"
```

---

## Task 17: Frontend — MicrotopicsTab and TopicTypeFeed

**Files:**
- Create: `packages/frontend/src/components/livechat/TopicTypeFeed.tsx`
- Create: `packages/frontend/src/components/livechat/MicrotopicsTab.tsx`

- [ ] **Step 1: Implement TopicTypeFeed**

Create `packages/frontend/src/components/livechat/TopicTypeFeed.tsx`:

```typescript
"use client";

import type { MicrotopicByTypeItem } from "./types";

export function TopicTypeFeed({ items }: { items: MicrotopicByTypeItem[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {items.map((item, i) => {
        const primaryExchange = item.microtopic.exchanges.find(
          (e) => e.label === "primary"
        );
        const userMsgs = primaryExchange?.messages.filter(
          (m) => m.role === "user"
        ) ?? [];
        const agentMsgs = primaryExchange?.messages.filter(
          (m) => m.role === "human_agent"
        ) ?? [];

        return (
          <div
            key={`${item.conversationId}-${i}`}
            className="bg-bg-surface rounded-md border border-border border-l-[3px] border-l-accent mb-2 p-2.5"
          >
            <div className="text-text-dim text-[10px] mb-1">
              {item.visitorName || "Unknown"} · #{item.conversationId} · {item.agentName}
            </div>
            {userMsgs.map((msg) => (
              <div key={msg.id} className="text-accent-bright text-xs mb-1">
                {msg.text}
              </div>
            ))}
            {agentMsgs.length > 0 && (
              <div className="text-text-muted text-xs pl-2 border-l-2 border-border mt-1">
                {agentMsgs.map((msg) => (
                  <div key={msg.id} className="mb-0.5">
                    {msg.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="text-text-dim text-xs text-center p-4">
          No items for this type
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement MicrotopicsTab**

Create `packages/frontend/src/components/livechat/MicrotopicsTab.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import type {
  MicrotopicsFile,
  RawTranscriptsFile,
  MicrotopicType,
} from "rag-evaluation-system/data-analysis";
import type { MicrotopicByTypeItem, MicrotopicsByType } from "./types";
import { ConversationList } from "./ConversationList";
import { MicrotopicCard } from "./MicrotopicCard";
import { TopicTypeFeed } from "./TopicTypeFeed";
import { ExportButton } from "./ExportButton";

const TYPE_ORDER: MicrotopicType[] = [
  "question",
  "request",
  "identity_info",
  "confirmation",
  "greeting",
  "closing",
  "uncategorized",
];

const TYPE_COLORS: Record<string, string> = {
  question: "text-accent",
  request: "text-[#818cf8]",
  identity_info: "text-[#fbbf24]",
  confirmation: "text-text-muted",
  greeting: "text-text-muted",
  closing: "text-text-muted",
  uncategorized: "text-text-dim",
};

export function MicrotopicsTab({
  microtopicsData,
  rawData,
}: {
  microtopicsData: MicrotopicsFile | null;
  rawData: RawTranscriptsFile | null;
}) {
  const [view, setView] = useState<"conversation" | "topicType">("conversation");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<MicrotopicType>("question");

  // Build indexes
  const byType = useMemo<MicrotopicsByType>(() => {
    const map: MicrotopicsByType = new Map();
    if (!microtopicsData || !rawData) return map;

    const rawMap = new Map(
      rawData.conversations.map((c) => [c.conversationId, c])
    );

    for (const conv of microtopicsData.conversations) {
      const raw = rawMap.get(conv.conversationId);
      for (const mt of conv.microtopics) {
        const items = map.get(mt.type) ?? [];
        items.push({
          conversationId: conv.conversationId,
          visitorName: raw?.visitorName ?? "",
          agentName: raw?.agentName ?? "",
          language: conv.language,
          microtopic: mt,
        });
        map.set(mt.type, items);
      }
    }
    return map;
  }, [microtopicsData, rawData]);

  // Conversations with user messages
  const conversations = useMemo(() => {
    if (!rawData) return [];
    return rawData.conversations.filter(
      (c) => c.metadata.messageCountVisitor > 0
    );
  }, [rawData]);

  const selectedConvMicrotopics = useMemo(() => {
    if (!selectedConvId || !microtopicsData) return null;
    return microtopicsData.conversations.find(
      (c) => c.conversationId === selectedConvId
    ) ?? null;
  }, [selectedConvId, microtopicsData]);

  const selectedRawConv = useMemo(
    () => conversations.find((c) => c.conversationId === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  if (!microtopicsData || !rawData) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view microtopics
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-[220px] border-r border-border flex flex-col">
        {/* Toggle */}
        <div className="p-1.5 border-b border-border">
          <div className="flex bg-bg-surface rounded border border-border overflow-hidden">
            <button
              onClick={() => setView("conversation")}
              className={`flex-1 text-center py-1 text-[9px] ${
                view === "conversation"
                  ? "bg-accent-dim text-accent-bright"
                  : "text-text-dim"
              }`}
            >
              By Conversation
            </button>
            <button
              onClick={() => setView("topicType")}
              className={`flex-1 text-center py-1 text-[9px] ${
                view === "topicType"
                  ? "bg-accent-dim text-accent-bright"
                  : "text-text-dim"
              }`}
            >
              By Topic Type
            </button>
          </div>
        </div>

        {view === "conversation" ? (
          <ConversationList
            conversations={conversations}
            selectedId={selectedConvId}
            onSelect={setSelectedConvId}
            renderBadges={(conv) => {
              const mt = microtopicsData.conversations.find(
                (c) => c.conversationId === conv.conversationId
              );
              if (!mt) return null;
              const counts: Record<string, number> = {};
              mt.microtopics.forEach((m) => {
                if (m.type !== "uncategorized") {
                  counts[m.type] = (counts[m.type] || 0) + 1;
                }
              });
              return (
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(counts).map(([type, count]) => (
                    <span
                      key={type}
                      className="text-[8px] bg-accent-dim text-accent-bright px-1 rounded"
                    >
                      {type[0].toUpperCase()}×{count}
                    </span>
                  ))}
                </div>
              );
            }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-1">
            {TYPE_ORDER.map((type) => {
              const items = byType.get(type) ?? [];
              if (items.length === 0) return null;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 flex justify-between ${
                    selectedType === type
                      ? "bg-bg-surface border-l-2 border-accent"
                      : "hover:bg-bg-hover"
                  }`}
                >
                  <span className={TYPE_COLORS[type] ?? "text-text-dim"}>
                    {type}
                  </span>
                  <span className="text-text-dim">{items.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === "conversation" ? (
          selectedConvMicrotopics ? (
            <>
              <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
                <div>
                  <span className="text-text text-xs font-semibold">
                    {selectedRawConv?.visitorName || "Unknown"}
                  </span>
                  <span className="text-text-dim text-[10px] ml-2">
                    #{selectedConvId}
                  </span>
                </div>
                <ExportButton
                  data={selectedConvMicrotopics}
                  filename={`microtopics-${selectedConvId}.json`}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {selectedConvMicrotopics.botFlowInput && (
                  <div className="text-center mb-2">
                    <span className="text-[#fbbf24] text-[10px] bg-[#fbbf2415] px-2 py-0.5 rounded-full border border-[#fbbf2430]">
                      {selectedConvMicrotopics.botFlowInput.intent} ·{" "}
                      {selectedConvMicrotopics.botFlowInput.language}
                    </span>
                  </div>
                )}
                {selectedConvMicrotopics.microtopics.map((mt, i) => (
                  <MicrotopicCard
                    key={i}
                    microtopic={mt}
                    agentName={selectedRawConv?.agentName}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-dim text-xs">
              Select a conversation
            </div>
          )
        ) : (
          <>
            <div className="bg-bg-elevated px-3 py-2 border-b border-border flex justify-between items-center">
              <div>
                <span className="text-accent text-xs font-semibold">
                  {(byType.get(selectedType) ?? []).length} {selectedType}s
                </span>
                <span className="text-text-dim text-[10px] ml-2">
                  across {microtopicsData.processedConversations} conversations
                </span>
              </div>
              <ExportButton
                data={{
                  type: selectedType,
                  exportedAt: new Date().toISOString(),
                  source: microtopicsData.source,
                  totalItems: (byType.get(selectedType) ?? []).length,
                  items: (byType.get(selectedType) ?? []).map((item) => ({
                    conversationId: item.conversationId,
                    visitorName: item.visitorName,
                    agentName: item.agentName,
                    language: item.language,
                    exchanges: item.microtopic.exchanges,
                    extracted: item.microtopic.extracted,
                  })),
                }}
                filename={`${selectedType}-export.json`}
              />
            </div>
            <TopicTypeFeed items={byType.get(selectedType) ?? []} />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/TopicTypeFeed.tsx packages/frontend/src/components/livechat/MicrotopicsTab.tsx
git commit -m "feat(frontend): add MicrotopicsTab with By Conversation and By Topic Type views"
```

---

## Task 18: Frontend — Wire Up LivechatView with Data Loading

**Files:**
- Modify: `packages/frontend/src/components/livechat/LivechatView.tsx`

- [ ] **Step 1: Update LivechatView to load data and render tabs**

Replace the content of `packages/frontend/src/components/livechat/LivechatView.tsx` with the full implementation that handles file upload, manifest polling, data loading, and renders all three tabs:

```typescript
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TabBar } from "./TabBar";
import { StatsTab } from "./StatsTab";
import { TranscriptsTab } from "./TranscriptsTab";
import { MicrotopicsTab } from "./MicrotopicsTab";
import type { LivechatTab, UploadEntry, LoadedData } from "./types";

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll manifest for upload status
  const refreshManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/livechat/manifest");
      if (res.ok) {
        const data = await res.json();
        setUploads(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshManifest();
    const interval = setInterval(refreshManifest, 3000);
    return () => clearInterval(interval);
  }, [refreshManifest]);

  // Load data when selecting an upload
  useEffect(() => {
    if (!selectedUploadId) {
      setLoadedData(null);
      return;
    }
    const upload = uploads.find((u) => u.id === selectedUploadId);
    if (!upload || upload.status !== "ready") {
      setLoadedData(null);
      return;
    }

    setLoading(true);
    Promise.all([
      fetch(`/api/livechat/data/${selectedUploadId}?type=basicStats`).then((r) => r.json()),
      fetch(`/api/livechat/data/${selectedUploadId}?type=rawTranscripts`).then((r) => r.json()),
      fetch(`/api/livechat/data/${selectedUploadId}?type=microtopics`).then((r) => r.json()),
    ])
      .then(([basicStats, rawTranscripts, microtopics]) => {
        setLoadedData({ basicStats, rawTranscripts, microtopics });
      })
      .catch(() => setLoadedData(null))
      .finally(() => setLoading(false));
  }, [selectedUploadId, uploads]);

  async function handleUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await fetch("/api/livechat/upload", { method: "POST", body: formData });
      await refreshManifest();
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar */}
      <div className="w-[180px] border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full text-xs bg-accent-dim text-accent-bright rounded px-2 py-1.5 hover:bg-accent-dim/80 transition-colors"
          >
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {uploads.length === 0 && (
            <div className="text-text-dim text-xs p-3 text-center">
              No uploads yet
            </div>
          )}
          {uploads.map((upload) => (
            <button
              key={upload.id}
              onClick={() => setSelectedUploadId(upload.id)}
              className={`w-full text-left p-2 rounded text-xs mb-0.5 ${
                selectedUploadId === upload.id
                  ? "bg-bg-surface border-l-2 border-accent text-accent"
                  : "text-text-muted hover:bg-bg-hover"
              }`}
            >
              <div className="truncate text-[10px]">{upload.filename}</div>
              <div className="text-text-dim text-[9px] mt-0.5">
                {upload.status === "ready" && upload.conversationCount
                  ? `${upload.conversationCount.toLocaleString()} convos · Ready`
                  : upload.status === "error"
                    ? "Error"
                    : upload.status}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-dim text-xs">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin mr-2" />
            Loading data...
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            {activeTab === "stats" && (
              <StatsTab stats={loadedData?.basicStats ?? null} />
            )}
            {activeTab === "transcripts" && (
              <TranscriptsTab data={loadedData?.rawTranscripts ?? null} />
            )}
            {activeTab === "microtopics" && (
              <MicrotopicsTab
                microtopicsData={loadedData?.microtopics ?? null}
                rawData={loadedData?.rawTranscripts ?? null}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build && pnpm -C packages/frontend build
```

Expected: Both builds succeed.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/LivechatView.tsx
git commit -m "feat(frontend): wire up LivechatView with upload, data loading, and all tabs"
```

---

## Task 19: Final Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Run all eval-lib tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test
```

Expected: All tests pass (including new data-analysis tests).

- [ ] **Step 2: Run full build**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build && pnpm -C packages/frontend build
```

Expected: Both builds succeed.

- [ ] **Step 3: Manual smoke test**

Start the frontend dev server and verify:
1. KB page shows icon rail with Documents and Livechat icons
2. Clicking Livechat icon shows the upload sidebar + tab bar
3. Documents icon switches back to normal KB view
4. Upload a small CSV (if available) and verify processing

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm dev
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat: livechat transcript analysis — complete implementation"
```
