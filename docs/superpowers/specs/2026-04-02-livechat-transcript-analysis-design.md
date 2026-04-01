# Livechat Transcript Analysis — Design Spec

**Date:** 2026-04-02
**Status:** Ready for review
**Module:** `packages/eval-lib/src/data-analysis/`

## Purpose

Analyze human livechat conversation transcripts from Vodafone Qatar (and similar customers) to:

1. **Extract structured Q&A pairs** for training and evaluating the RAG retrieval system and chatbot
2. **Produce basic statistics** for understanding the dataset (conversation counts, agent/visitor breakdowns, durations)
3. **Segment conversations into microtopics** with categorized message exchanges for downstream use in synthetic question generation

The CSV format is standard across customers using our native livechat system, making this module reusable.

## Input Data

### CSV Format

Two CSV files (same schema, different date ranges):
- `[1] VFQ - Telesales Human Livechat Conversations - 1st Jul 2025 - 31st Dec 2025.csv` (53MB, ~37K conversations)
- `[2] VFQ - Telesales Human Livechat Conversations - 1st Jan 2026 - 31st Mar 2026.csv` (35MB, ~24K conversations)

**22 columns:**

| Column | Description |
|--------|-------------|
| Conversation ID | Unique conversation identifier |
| Visitor ID | Unique visitor identifier |
| Visitor Name | Display name |
| Visitor Email | May be empty |
| Visitor Phone | Usually present (WhatsApp-based) |
| Agent ID | Human agent identifier |
| Agent Name | Human agent display name |
| Agent Email | Human agent email |
| Inbox ID | Routing inbox ID |
| Inbox | Inbox name (e.g., "Tars Livechat") |
| Labels | Comma-separated tags (campaign, language, etc.) |
| Status | Conversation status (e.g., "Resolved") |
| Transcript | Full conversation as `Speaker : message \|\| Speaker : message` |
| Number of messages sent by the visitor | Integer count |
| Number of messages sent by the agent | Integer count |
| Total Conversation duration in Seconds | Integer |
| Start Date | DD/MM/YYYY |
| Start Time | HH:MM:SS AM/PM |
| Reply Date | DD/MM/YYYY |
| Reply Time | HH:MM:SS AM/PM |
| Last Activity Date | DD/MM/YYYY |
| Last Activity Time | HH:MM:SS AM/PM |

### Transcript Format

Messages delimited by ` || ` with speaker prefix `Speaker : `:

```
Visitor : message text || Agent : response text || Unknown : system event
```

**Speaker roles:**
- `Visitor` → end user (`"user"`)
- `Agent` → human support agent (`"human_agent"`)
- `Unknown` → system/workflow events (`"workflow_input"`) — includes bot flow selections, agent assignments, label changes, resolution events

**Common workflow_input patterns (deterministically identifiable):**
- `"Assigned to {name} by {name}"` — agent assignment
- `"Conversation unassigned by {name}"` — agent unassignment
- `"{name} self-assigned this conversation"` — self-assignment
- `"{name} added {labels}"` — label addition
- `"Conversation was marked resolved by {name}"` — resolution
- Bot flow selections (first message): comma-separated values like `"Continue in English, -No Input-, New Postpaid Plan, English,"`

**Languages:** English, Arabic, and bilingual conversations. Language detectable from the `Labels` column (e.g., `language_english`, `language_arabic`).

## Output

Three JSON files per CSV, written to a configurable output directory (default `data/output/`).

### 1. Raw Transcripts (`raw-transcripts-{period}.json`)

Deterministic parse of CSV transcripts into structured JSON. No AI involved.

```typescript
interface RawMessage {
  id: number;                              // Sequential, 1-based per conversation
  role: "user" | "human_agent" | "workflow_input";
  text: string;                            // Verbatim from transcript
}

interface RawConversation {
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

interface RawTranscriptsFile {
  source: string;                          // Original CSV filename
  generatedAt: string;                     // ISO timestamp
  totalConversations: number;
  conversations: RawConversation[];
}
```

### 2. Microtopics (`microtopics-{period}.json`)

AI-assisted segmentation and categorization. References message IDs from raw transcripts.

```typescript
type MicrotopicType =
  | "identity_info"
  | "question"
  | "request"
  | "confirmation"
  | "greeting"
  | "closing"
  | "uncategorized";

interface MicrotopicMessage {
  id: number;                              // References RawMessage.id
  role: "user" | "human_agent" | "workflow_input";
  text: string;                            // Verbatim, assembled from raw transcript
}

interface Exchange {
  label: "primary" | "follow_up";
  messages: MicrotopicMessage[];           // Assembled by deterministic script from IDs
}

interface ExtractedInfo {
  type: string;                            // "name", "phone", "email", "address", "qid", etc.
  value: string;
}

interface Microtopic {
  type: MicrotopicType;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];             // Present for identity_info, optional for others
}

interface ConversationMicrotopics {
  conversationId: string;
  language: string;
  botFlowInput?: {
    rawText: string;
    intent: string;
    language: string;
    messageIds: number[];
  };
  microtopics: Microtopic[];
}

interface MicrotopicsFile {
  source: string;
  generatedAt: string;
  model: string;                           // "claude-sonnet-4-6"
  totalConversations: number;
  processedConversations: number;          // May be less than total (--limit)
  failures: string[];                      // Conversation IDs that failed AI extraction
  conversations: ConversationMicrotopics[];
}
```

**LLM output schema (ID-only — no text reproduction):**

The LLM returns only boundary and classification data. Message text is never reproduced by the LLM — it is assembled deterministically from the raw transcript after the LLM call.

```typescript
// What the LLM returns per conversation
interface LLMExtractionResult {
  microtopics: {
    type: MicrotopicType;
    exchanges: {
      label: "primary" | "follow_up";
      messageIds: number[];              // References to RawMessage.id
    }[];
    extracted?: ExtractedInfo[];         // Only for identity_info
  }[];
}
```

### 3. Basic Stats (`basic-stats-{period}.json`)

Aggregate statistics computed deterministically from CSV data.

```typescript
interface BasicStats {
  source: string;
  generatedAt: string;
  totalConversations: number;
  uniqueVisitors: number;
  uniqueAgents: number;
  statusBreakdown: Record<string, number>;
  labelBreakdown: Record<string, number>;
  agentBreakdown: {
    agentName: string;
    agentEmail: string;
    conversationCount: number;
    totalMessagesFromAgent: number;
  }[];
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
```

## Module Structure

```
packages/eval-lib/src/data-analysis/
  index.ts                     # Public API re-exports
  types.ts                     # All TypeScript interfaces (as defined above, including TopicTypeExport)
  csv-parser.ts                # Streaming CSV parser using csv-parse
  transcript-parser.ts         # Deterministic transcript string -> RawMessage[] parser
  basic-stats.ts               # Aggregate statistics calculator
  microtopic-extractor.ts      # AI-assisted microtopic segmentation + categorization
  claude-client.ts             # Anthropic SDK wrapper for microtopic extraction
  run-stats.ts                 # CLI entry: basic stats
  run-parse.ts                 # CLI entry: parse transcripts (JSON 1)
  run-microtopics.ts           # CLI entry: extract microtopics (JSON 2)
```

**Sub-path export** in `package.json`:
```json
"./data-analysis": {
  "types": "./dist/data-analysis/index.d.ts",
  "import": "./dist/data-analysis/index.js"
}
```

**New dependencies:**
- `csv-parse` — regular dependency (streaming CSV parsing with quoted field support)
- `@anthropic-ai/sdk` — optional dependency (same pattern as existing `openai`, `cohere-ai`)

**Build config changes (`tsup.config.ts`):**
- Add entry: `"src/data-analysis/index.ts"`
- Add to external: `"@anthropic-ai/sdk"`, `"csv-parse"`

**Environment variable:**
- `ANTHROPIC_API_KEY` — required for microtopic extraction only

## Processing Pipeline

### Script 1: Basic Stats (`run-stats.ts`)

Deterministic. Streams CSV row-by-row, accumulates counters.

```
CSV file → csv-parse stream → accumulate counts → compute aggregates → basic-stats.json
```

- Counts unique visitors/agents by their IDs
- Parses labels by splitting on comma
- Collects message counts and durations into arrays for median calculation (~37K numbers, trivial in memory)
- No transcript parsing needed — uses only the metadata columns

### Script 2: Transcript Parser (`run-parse.ts`)

Deterministic. No AI. Streams CSV, parses each transcript string.

```
CSV file → csv-parse stream → per-row transcript parse → raw-transcripts.json
```

**Transcript parsing logic:**
1. Split transcript on ` || ` delimiter
2. For each segment, match speaker prefix regex: `/^(Visitor|Agent|Unknown)\s*:\s*/`
3. Map speaker to role: `Visitor` → `"user"`, `Agent` → `"human_agent"`, `Unknown` → `"workflow_input"`
4. Strip the speaker prefix, keep remaining text verbatim
5. Assign sequential IDs starting at 1
6. Extract other CSV columns into `RawConversation` fields
7. Parse labels by splitting on comma and trimming whitespace

**Edge cases:**
- Empty transcript → `messages: []`
- Transcript with no ` || ` delimiters → single message
- Missing speaker prefix → default to `"workflow_input"` role
- Segments with only whitespace → skip (don't assign ID)

### Script 3: Microtopic Extractor (`run-microtopics.ts`)

Takes `raw-transcripts.json` as input. Two phases.

```
raw-transcripts.json → deterministic pre-processing → Claude Sonnet 4.6 API → deterministic assembly → microtopics.json
```

#### Phase A: Deterministic Pre-processing

For each conversation:

1. **Detect botFlowInput**: If the first message has role `"workflow_input"` and matches the bot flow pattern, extract it as `botFlowInput` and remove from the message list sent to the LLM. Bot flow messages are comma-separated values like `"Continue in English, -No Input-, New Postpaid Plan, English,"`. Parsing heuristic: split on comma, trim whitespace, filter out empty strings and `"-No Input-"`. The last non-empty token matching a known language (`English`, `Arabic`) becomes the `language` field. The remaining substantive token (e.g., `"New Postpaid Plan"`, `"GigaHome Fibre"`) becomes the `intent` field. If parsing fails, set `intent` and `language` to `"unknown"` and keep `rawText` verbatim.

2. **Identify system messages**: Match `workflow_input` messages against known patterns:
   - `"Assigned to {name} by {name}"`
   - `"Conversation unassigned by {name}"`
   - `"{name} self-assigned this conversation"`
   - `"{name} added {labels}"`
   - `"Conversation was marked resolved by {name}"`
   
   These are pre-classified as `"uncategorized"` and excluded from the LLM input to reduce token usage.

3. **Prepare LLM input**: The remaining user + human_agent messages (with their IDs preserved) are sent to the LLM for segmentation. If no user/human_agent messages remain after filtering (conversation is entirely workflow_input), skip the LLM call — all messages become `uncategorized` microtopics.

#### Phase B: AI-assisted Classification

**Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`)

**System prompt:**
```
You are analyzing customer support chat transcripts from a telecom company (Vodafone Qatar).

Your task is to segment the conversation into microtopics and classify each one. You will receive messages with their IDs. Return ONLY message IDs and classifications — do NOT reproduce message text.

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
7. A single message from the agent (like a greeting or closing template) can be its own microtopic
```

**User message per conversation:**
```
Messages:
[{"id":9,"role":"human_agent","text":"Hello..."},{"id":10,"role":"user","text":"Yes"},...]

Return JSON matching this schema:
{
  "microtopics": [
    {
      "type": "<type>",
      "exchanges": [
        { "label": "primary" | "follow_up", "messageIds": [<ids>] }
      ],
      "extracted": [{"type": "<info_type>", "value": "<value>"}]
    }
  ]
}
```

**Output method:** Anthropic tool use (function calling) with the `LLMExtractionResult` schema to enforce structured JSON output.

#### Phase C: Deterministic Assembly

After receiving the LLM's ID-only response:

1. **Validate coverage**: Collect all message IDs from the LLM output. Compare against the input message IDs.
   - Missing IDs → append as an `uncategorized` microtopic
   - Duplicate IDs → keep first occurrence, log warning
   - Hallucinated IDs (not in input) → strip them, log warning
2. **Merge with pre-classified messages**: Combine the LLM's microtopics with the deterministically pre-classified `uncategorized` system messages. Final microtopics are ordered by their lowest message ID (e.g., a workflow_input message with ID 5 becomes its own `uncategorized` microtopic positioned between the microtopic containing ID 4 and the one containing ID 6).
3. **Assemble full messages**: For each microtopic, for each exchange, look up message objects from the raw transcript by ID and populate the `messages` array with full `MicrotopicMessage` objects (id, role, text).
4. **Attach botFlowInput**: Add the pre-extracted `botFlowInput` to the conversation.
5. **Detect language**: From the conversation's labels (`language_english`, `language_arabic`) or default to `"unknown"`.

#### Concurrency and Cost

- **Batch size**: 10 concurrent API calls
- **Initial run**: First 200 conversations (`--limit 200`) for quality validation
- **Estimated cost**: ~1K input tokens + ~300 output tokens per conversation (ID-only output is compact). 200 conversations at Sonnet pricing ≈ $0.50–$1.00.
- **Scaling**: After validation, run full dataset with `--limit` removed

#### Error Handling

- API call failure for a conversation → log error, add conversation ID to `failures` array, continue
- Malformed LLM response → treat all messages as `uncategorized`, log warning
- Rate limiting → exponential backoff with 3 retries

## CLI Interface

```bash
# Basic stats
npx tsx packages/eval-lib/src/data-analysis/run-stats.ts \
  --input "data/[1] VFQ - Telesales Human Livechat Conversations - 1st Jul 2025 - 31st Dec 2025.csv" \
  --output "data/output/basic-stats-h2-2025.json"

# Parse transcripts → JSON 1 (deterministic)
npx tsx packages/eval-lib/src/data-analysis/run-parse.ts \
  --input "data/[1] VFQ - Telesales Human Livechat Conversations - 1st Jul 2025 - 31st Dec 2025.csv" \
  --output "data/output/raw-transcripts-h2-2025.json"

# Extract microtopics → JSON 2 (requires ANTHROPIC_API_KEY)
npx tsx packages/eval-lib/src/data-analysis/run-microtopics.ts \
  --input "data/output/raw-transcripts-h2-2025.json" \
  --output "data/output/microtopics-h2-2025.json" \
  --limit 200 \
  --concurrency 10
```

All scripts print progress to stderr and write JSON to the specified output path. CLI args are parsed from `process.argv` directly (no external arg parsing library needed — just `--input`, `--output`, `--limit`, `--concurrency`).

**Git:** `data/output/` should be added to `.gitignore` — generated JSON files are large and should not be committed.

## Examples

### Raw Transcript (JSON 1) — Single Conversation

```json
{
  "conversationId": "360250",
  "visitorId": "92733",
  "visitorName": "Gökhan",
  "visitorPhone": "+97431244425",
  "visitorEmail": "",
  "agentId": "1486",
  "agentName": "Aya Mohsen Kamel Sawaftah",
  "agentEmail": "aya.sawafta@extensya.com",
  "inbox": "Tars Livechat",
  "labels": ["campaign_mobile_connection", "language_english"],
  "status": "Resolved",
  "messages": [
    { "id": 1, "role": "workflow_input", "text": "Continue in English, -No Input-, New Postpaid Plan, English," },
    { "id": 2, "role": "workflow_input", "text": "Assigned to Weam Weal Khader by Tars Admin" },
    { "id": 3, "role": "user", "text": "Gökhan" },
    { "id": 4, "role": "user", "text": "Gokhan" },
    { "id": 5, "role": "workflow_input", "text": "Conversation unassigned by Weam Weal Khader" },
    { "id": 6, "role": "user", "text": "?" },
    { "id": 7, "role": "user", "text": "Hey" },
    { "id": 8, "role": "user", "text": "New Postpaid Plan" },
    { "id": 9, "role": "workflow_input", "text": "Aya Mohsen Kamel Sawaftah self-assigned this conversation" },
    { "id": 10, "role": "human_agent", "text": "Hello, thank you for reaching out to us. My name is Aya, I will be assisting you for this Whatsapp session. We have some amazing offers available on our postpaid plans, would you like me to provide more details?" },
    { "id": 11, "role": "user", "text": "Yes" },
    { "id": 12, "role": "human_agent", "text": "Do you have Vodafone postpaid number and you want to upgrade its plan?" },
    { "id": 13, "role": "workflow_input", "text": "Aya Mohsen Kamel Sawaftah added campaign_mobile_connection, language_english" },
    { "id": 14, "role": "user", "text": "Yes" },
    { "id": 15, "role": "human_agent", "text": "Please confirm your Vodafone mobile number ?" },
    { "id": 16, "role": "user", "text": "31244425" },
    { "id": 17, "role": "human_agent", "text": "Thank you sir,let me check" },
    { "id": 18, "role": "user", "text": "How many GB of internet?" },
    { "id": 19, "role": "user", "text": "?" },
    { "id": 20, "role": "human_agent", "text": "This is plan details \nUnlimited 300QR Plus plan\n\n225QR monthly for 6 months\n\nUnlimited local calls \n\nUnlimited internet;First 75 GB full Speed +50GB for social Media then unlimited data at the speed of 10 Mbps. The FUP for the 10 Mbps data is 450 GB\n\n200 international minutes \n5GB Roaming Data" },
    { "id": 21, "role": "human_agent", "text": "Are you interested to upgrade?" },
    { "id": 22, "role": "user", "text": "Will the price change after 6 months?" },
    { "id": 23, "role": "user", "text": "?" },
    { "id": 24, "role": "user", "text": "Aya" },
    { "id": 25, "role": "human_agent", "text": "Any discount only for 6 month" },
    { "id": 26, "role": "human_agent", "text": "and the discount available only to Upgrade your plan \nTo downgrade no discount" },
    { "id": 27, "role": "user", "text": "I need a 12-month discounted package" },
    { "id": 28, "role": "user", "text": "I want to upgrade but not for 6 months but for 12 months" },
    { "id": 29, "role": "human_agent", "text": "Sorry sir the discount only for 6 month" },
    { "id": 30, "role": "user", "text": "Don't have a 12-month package?" },
    { "id": 31, "role": "human_agent", "text": "No sir" },
    { "id": 32, "role": "user", "text": "Ok" },
    { "id": 33, "role": "human_agent", "text": "Are you interested to upgrade?" },
    { "id": 34, "role": "user", "text": "No, I think I'll start using ooredoo. Thanks" },
    { "id": 35, "role": "human_agent", "text": "Thank you for reaching out to Vodafone store on WhatsApp. You can get offers, recharge, pay bills, buy add-ons, track usage, raise or manage complaints & lots more via My Vodafone App https://mva.qa/. You can also check out our frequently asked questions on our website https://www.vodafone.qa/en/help/faqs" },
    { "id": 36, "role": "human_agent", "text": "This message was deleted" },
    { "id": 37, "role": "human_agent", "text": "Need higher discount validity" },
    { "id": 38, "role": "workflow_input", "text": "Conversation was marked resolved by Aya Mohsen Kamel Sawaftah" }
  ],
  "metadata": {
    "messageCountVisitor": 19,
    "messageCountAgent": 15,
    "totalDurationSeconds": 63650,
    "startDate": "01/07/2025",
    "startTime": "12:16:31 AM",
    "replyDate": "01/07/2025",
    "replyTime": "3:23:32 PM",
    "lastActivityDate": "01/07/2025",
    "lastActivityTime": "5:57:21 PM"
  }
}
```

### Microtopics (JSON 2) — Same Conversation

> **Note:** Examples below are illustrative. Actual LLM output may differ in classification decisions (e.g., whether pre-agent waiting messages like "?", "Hey" are grouped with identity_info or as a separate microtopic). The structure and ID-based approach are what matter.

**LLM receives** (after deterministic pre-processing removes workflow_input messages 2, 5, 9, 13, 38):

```json
[
  { "id": 3, "role": "user", "text": "Gökhan" },
  { "id": 4, "role": "user", "text": "Gokhan" },
  { "id": 6, "role": "user", "text": "?" },
  { "id": 7, "role": "user", "text": "Hey" },
  { "id": 8, "role": "user", "text": "New Postpaid Plan" },
  { "id": 10, "role": "human_agent", "text": "Hello, thank you for reaching out..." },
  { "id": 11, "role": "user", "text": "Yes" },
  { "id": 12, "role": "human_agent", "text": "Do you have Vodafone postpaid number..." },
  { "id": 14, "role": "user", "text": "Yes" },
  { "id": 15, "role": "human_agent", "text": "Please confirm your Vodafone mobile number ?" },
  { "id": 16, "role": "user", "text": "31244425" },
  { "id": 17, "role": "human_agent", "text": "Thank you sir,let me check" },
  { "id": 18, "role": "user", "text": "How many GB of internet?" },
  { "id": 19, "role": "user", "text": "?" },
  { "id": 20, "role": "human_agent", "text": "This is plan details..." },
  { "id": 21, "role": "human_agent", "text": "Are you interested to upgrade?" },
  { "id": 22, "role": "user", "text": "Will the price change after 6 months?" },
  { "id": 23, "role": "user", "text": "?" },
  { "id": 24, "role": "user", "text": "Aya" },
  { "id": 25, "role": "human_agent", "text": "Any discount only for 6 month" },
  { "id": 26, "role": "human_agent", "text": "and the discount available only to Upgrade your plan..." },
  { "id": 27, "role": "user", "text": "I need a 12-month discounted package" },
  { "id": 28, "role": "user", "text": "I want to upgrade but not for 6 months but for 12 months" },
  { "id": 29, "role": "human_agent", "text": "Sorry sir the discount only for 6 month" },
  { "id": 30, "role": "user", "text": "Don't have a 12-month package?" },
  { "id": 31, "role": "human_agent", "text": "No sir" },
  { "id": 32, "role": "user", "text": "Ok" },
  { "id": 33, "role": "human_agent", "text": "Are you interested to upgrade?" },
  { "id": 34, "role": "user", "text": "No, I think I'll start using ooredoo. Thanks" },
  { "id": 35, "role": "human_agent", "text": "Thank you for reaching out to Vodafone..." },
  { "id": 36, "role": "human_agent", "text": "This message was deleted" },
  { "id": 37, "role": "human_agent", "text": "Need higher discount validity" }
]
```

**LLM returns** (ID-only):

```json
{
  "microtopics": [
    {
      "type": "identity_info",
      "exchanges": [
        { "label": "primary", "messageIds": [3, 4, 6, 7, 8] }
      ],
      "extracted": [
        { "type": "name", "value": "Gökhan" }
      ]
    },
    {
      "type": "greeting",
      "exchanges": [
        { "label": "primary", "messageIds": [10, 11] }
      ]
    },
    {
      "type": "identity_info",
      "exchanges": [
        { "label": "primary", "messageIds": [12, 14, 15, 16, 17] }
      ],
      "extracted": [
        { "type": "phone", "value": "31244425" }
      ]
    },
    {
      "type": "question",
      "exchanges": [
        { "label": "primary", "messageIds": [18, 19, 20] },
        { "label": "follow_up", "messageIds": [21, 22, 23, 24, 25, 26] }
      ]
    },
    {
      "type": "request",
      "exchanges": [
        { "label": "primary", "messageIds": [27, 28, 29] },
        { "label": "follow_up", "messageIds": [30, 31] }
      ]
    },
    {
      "type": "confirmation",
      "exchanges": [
        { "label": "primary", "messageIds": [32, 33] }
      ]
    },
    {
      "type": "closing",
      "exchanges": [
        { "label": "primary", "messageIds": [34, 35] }
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messageIds": [36, 37] }
      ]
    }
  ]
}
```

**After deterministic assembly** (merging LLM output + pre-classified workflow messages + botFlowInput):

```json
{
  "conversationId": "360250",
  "language": "English",
  "botFlowInput": {
    "rawText": "Continue in English, -No Input-, New Postpaid Plan, English,",
    "intent": "New Postpaid Plan",
    "language": "English",
    "messageIds": [1]
  },
  "microtopics": [
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 2, "role": "workflow_input", "text": "Assigned to Weam Weal Khader by Tars Admin" }
        ]}
      ]
    },
    {
      "type": "identity_info",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 3, "role": "user", "text": "Gökhan" },
          { "id": 4, "role": "user", "text": "Gokhan" },
          { "id": 6, "role": "user", "text": "?" },
          { "id": 7, "role": "user", "text": "Hey" },
          { "id": 8, "role": "user", "text": "New Postpaid Plan" }
        ]}
      ],
      "extracted": [
        { "type": "name", "value": "Gökhan" }
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 5, "role": "workflow_input", "text": "Conversation unassigned by Weam Weal Khader" }
        ]}
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 9, "role": "workflow_input", "text": "Aya Mohsen Kamel Sawaftah self-assigned this conversation" }
        ]}
      ]
    },
    {
      "type": "greeting",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 10, "role": "human_agent", "text": "Hello, thank you for reaching out to us. My name is Aya, I will be assisting you for this Whatsapp session. We have some amazing offers available on our postpaid plans, would you like me to provide more details?" },
          { "id": 11, "role": "user", "text": "Yes" }
        ]}
      ]
    },
    {
      "type": "identity_info",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 12, "role": "human_agent", "text": "Do you have Vodafone postpaid number and you want to upgrade its plan?" },
          { "id": 14, "role": "user", "text": "Yes" },
          { "id": 15, "role": "human_agent", "text": "Please confirm your Vodafone mobile number ?" },
          { "id": 16, "role": "user", "text": "31244425" },
          { "id": 17, "role": "human_agent", "text": "Thank you sir,let me check" }
        ]}
      ],
      "extracted": [
        { "type": "phone", "value": "31244425" }
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 13, "role": "workflow_input", "text": "Aya Mohsen Kamel Sawaftah added campaign_mobile_connection, language_english" }
        ]}
      ]
    },
    {
      "type": "question",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 18, "role": "user", "text": "How many GB of internet?" },
          { "id": 19, "role": "user", "text": "?" },
          { "id": 20, "role": "human_agent", "text": "This is plan details \nUnlimited 300QR Plus plan\n\n225QR monthly for 6 months\n\nUnlimited local calls \n\nUnlimited internet;First 75 GB full Speed +50GB for social Media then unlimited data at the speed of 10 Mbps. The FUP for the 10 Mbps data is 450 GB\n\n200 international minutes \n5GB Roaming Data" }
        ]},
        { "label": "follow_up", "messages": [
          { "id": 21, "role": "human_agent", "text": "Are you interested to upgrade?" },
          { "id": 22, "role": "user", "text": "Will the price change after 6 months?" },
          { "id": 23, "role": "user", "text": "?" },
          { "id": 24, "role": "user", "text": "Aya" },
          { "id": 25, "role": "human_agent", "text": "Any discount only for 6 month" },
          { "id": 26, "role": "human_agent", "text": "and the discount available only to Upgrade your plan \nTo downgrade no discount" }
        ]}
      ]
    },
    {
      "type": "request",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 27, "role": "user", "text": "I need a 12-month discounted package" },
          { "id": 28, "role": "user", "text": "I want to upgrade but not for 6 months but for 12 months" },
          { "id": 29, "role": "human_agent", "text": "Sorry sir the discount only for 6 month" }
        ]},
        { "label": "follow_up", "messages": [
          { "id": 30, "role": "user", "text": "Don't have a 12-month package?" },
          { "id": 31, "role": "human_agent", "text": "No sir" }
        ]}
      ]
    },
    {
      "type": "confirmation",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 32, "role": "user", "text": "Ok" },
          { "id": 33, "role": "human_agent", "text": "Are you interested to upgrade?" }
        ]}
      ]
    },
    {
      "type": "closing",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 34, "role": "user", "text": "No, I think I'll start using ooredoo. Thanks" },
          { "id": 35, "role": "human_agent", "text": "Thank you for reaching out to Vodafone store on WhatsApp. You can get offers, recharge, pay bills, buy add-ons, track usage, raise or manage complaints & lots more via My Vodafone App https://mva.qa/. You can also check out our frequently asked questions on our website https://www.vodafone.qa/en/help/faqs" }
        ]}
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 36, "role": "human_agent", "text": "This message was deleted" },
          { "id": 37, "role": "human_agent", "text": "Need higher discount validity" }
        ]}
      ]
    },
    {
      "type": "uncategorized",
      "exchanges": [
        { "label": "primary", "messages": [
          { "id": 38, "role": "workflow_input", "text": "Conversation was marked resolved by Aya Mohsen Kamel Sawaftah" }
        ]}
      ]
    }
  ]
}
```

## Frontend

### Placement: Vertical Icon Rail in KB Page

The livechat transcript analysis lives within the Knowledge Base page, accessed via a narrow **vertical icon rail** on the left edge. Two icons:
- **Documents** (current KB view) — default
- **Livechat Transcripts** (new analysis view)

Clicking the livechat icon replaces the entire KB page content to the right of the rail. All livechat components are self-contained and isolated so they can be moved to a different location later.

### Layout: Upload List + Tab Content

The livechat view has two regions:
- **Left sidebar** (~200px): Lists uploaded CSV files. Each entry shows the filename, conversation count, and processing status (Pending / Processing / Analyzed). An "Upload" button at the top opens a file picker for CSV upload.
- **Main content area**: Three tabs — **Stats**, **Transcripts**, **Microtopics**

### Stats Tab

Dashboard cards showing aggregate statistics from `basic-stats.json`:
- **Top row** (4 cards): Total Conversations, Unique Visitors, Unique Agents, Avg Duration
- **Bottom row** (2 cards): Top Agents (name + conversation count), Labels breakdown (label + count)

### Transcripts Tab

**Chat bubble view** for browsing raw parsed conversations:
- **Left panel**: Scrollable conversation list with search. Each entry shows visitor name, conversation ID, agent name, message count, duration.
- **Right panel**: Selected conversation displayed as chat bubbles:
  - User messages: right-aligned, green (`accent-dim` background, `accent-bright` text)
  - Agent messages: left-aligned, dark (`bg-surface` background, `text` color, `border` border)
  - Workflow messages: centered system pills (subtle, dimmed)
  - Each message shows its ID as a subtle tag (e.g., `#18`)
  - Conversation header shows visitor name, ID, phone, status badges, language

### Microtopics Tab

Two sub-views controlled by a **segmented toggle above the left sidebar** ("By Conversation" / "By Topic Type"). The toggle switches both the sidebar content and the main content.

#### By Conversation View

- **Left sidebar**: Toggle at top, then search, then conversation list with microtopic badges (e.g., `Q×2 R×1`)
- **Main content**: Selected conversation's microtopics as **accordion cards**:
  - Bot flow input shown as a centered pill at the top (intent + language)
  - Workflow events summarized as a centered dimmed line
  - Each microtopic is a collapsible card with:
    - Color-coded type badge: green=question, purple=request, yellow=identity_info, gray=greeting/closing/confirmation
    - Preview text when collapsed (first user message or extracted info summary)
    - Message count
  - Expanded card shows exchanges with **Primary** and **Follow-up** sections
  - Messages inside exchanges use the same chat bubble style (user right, agent left)
  - `identity_info` cards show extracted data (name, phone, etc.) as tags
- **Export button** (top-right): Exports the selected conversation's microtopics as JSON — same format as `ConversationMicrotopics` from JSON 2

#### By Topic Type View

- **Left sidebar**: Toggle at top, then topic type list with counts. Each type is color-coded and shows the count of microtopics across all conversations. Clicking a type filters the main content.
- **Main content**: Flat scrollable feed of all microtopics matching the selected type:
  - Header shows count and conversation span (e.g., "847 questions across 200 conversations")
  - Each card shows:
    - Conversation reference (visitor name, conversation ID, agent name)
    - User message prominently displayed
    - Agent response below, indented with a left border
  - Cards are sorted by conversation order (can be extended with sorting later)
- **Export button** (top-right): Exports all microtopics of the selected type as JSON

#### Topic Type Export Format

```typescript
interface TopicTypeExport {
  type: MicrotopicType;
  exportedAt: string;
  source: string;                        // CSV filename
  totalItems: number;
  items: {
    conversationId: string;
    visitorName: string;
    agentName: string;
    language: string;
    exchanges: Exchange[];               // Same structure as Microtopic.exchanges
    extracted?: ExtractedInfo[];          // For identity_info type
  }[];
}
```

### Processing Flow (Frontend)

1. User uploads a CSV file (max ~500-1000 conversations for frontend processing)
2. Frontend sends CSV to an API route (Next.js server action or API route) that runs the three scripts sequentially:
   - Basic stats → `basic-stats.json`
   - Transcript parsing → `raw-transcripts.json`
   - Microtopic extraction → `microtopics.json` (with `--limit` for initial batch)
3. Progress shown in the upload list sidebar (Pending → Processing → Analyzed)
4. Once complete, JSON files are loaded into the frontend and displayed across the three tabs

**Note:** For the initial implementation, processing happens server-side via the CLI scripts. The frontend loads the resulting JSON files. No database storage — JSON files only.

### Filtering: Conversations Without User Messages

Conversations where the end user sent zero messages (only workflow_input and possibly human_agent messages) are filtered out from the Transcripts and Microtopics views by default. They are still present in the JSON files and counted in basic stats, but hidden from the interactive views since they contain no usable Q&A data. A "Show all" toggle can be added later to inspect them.

### Component Isolation

All livechat transcript components are kept in a separate directory:

```
packages/frontend/src/components/livechat/
  LivechatView.tsx             # Root component (replaces KB content when rail icon active)
  UploadSidebar.tsx            # Left sidebar with upload list
  StatsTab.tsx                 # Stats dashboard
  TranscriptsTab.tsx           # Chat bubble transcript viewer
  MicrotopicsTab.tsx           # Microtopics viewer (both sub-views)
  ConversationList.tsx         # Reusable conversation list for Transcripts + Microtopics
  ChatBubble.tsx               # Reusable message bubble component
  MicrotopicCard.tsx           # Collapsible microtopic accordion card
  TopicTypeFeed.tsx            # Flat feed for By Topic Type view
  ExportButton.tsx             # JSON export button
```

The icon rail toggle is added to the KB page (`app/kb/page.tsx`) but renders `<LivechatView />` as a self-contained unit.

## Constraints and Non-Goals

**Constraints:**
- CSV files must not be loaded into LLM context — always process via streaming scripts
- JSON 1 (raw transcripts) must be fully deterministic — no AI, no non-determinism
- JSON 2 (microtopics) uses AI only for segmentation/classification boundaries — message text is never reproduced by the LLM
- All message IDs from JSON 1 must appear in JSON 2 (no dropped messages)
- Initial microtopic extraction limited to 200 conversations for quality validation
- Frontend processes CSVs up to ~500-1000 conversations; larger files use CLI scripts directly

**Non-goals (for now):**
- Database storage of analysis output (JSON files only)
- Automated feeding of Q&A pairs into the question generation module (future integration)
- Processing of non-livechat transcript formats
- Editing/moving messages between microtopics in the UI (future feature)
- Sorting/advanced filtering in the By Topic Type view (future feature)
