# Classification System Redesign

## Summary

Redesign the live chat transcript message classification system to be template-driven, more accurate, and produce structured output suitable for eval dataset extraction. Replace the current single-pass, hardcoded classifier with a configurable template system, per-message labels, deterministic block grouping, follow-up detection, and standalone question reconstruction.

## Goals

1. Improve classification accuracy to 90%+ (currently unreliable — confuses greetings/questions/requests)
2. Produce clean question-answer pairs for eval dataset extraction
3. Make the classification system configurable via templates (extensible to new use cases)
4. Enable inline label editing so users can correct classification errors
5. Detect follow-up questions and reconstruct them as standalone questions with full context

## Non-Goals

- User-created custom templates in the UI (future change)
- Classification evaluation/accuracy measurement dashboard (future change)
- Consensus-based confidence scoring (future change)
- Resolution tracking on requests (future change)

---

## Architecture

### Template System

Templates are TypeScript objects in `packages/eval-lib/src/data-analysis/templates/`. Each template defines the classification schema.

```typescript
interface ClassificationTemplate {
  id: string;                      // "cx-transcript-analysis"
  name: string;                    // "CX Transcript Analysis"
  description: string;
  categories: CategoryDefinition[];
  agentRoles: AgentRoleDefinition[];
  disambiguationRules: string[];
}

interface CategoryDefinition {
  id: string;                      // "question"
  name: string;
  description: string;
  examples: FewShotExample[];      // 2-3 labeled examples per category
  extractFields?: boolean;         // e.g., identity_info extracts structured data
}

interface AgentRoleDefinition {
  id: string;                      // "response" | "proactive" | "procedural"
  name: string;
  description: string;
}

interface FewShotExample {
  message: string;
  role: "user" | "human_agent";
  context?: string;
}
```

**File structure:**
- `src/data-analysis/templates/index.ts` — registry, lookup by ID
- `src/data-analysis/templates/cx-transcript-analysis.ts` — Template #1 (7 user categories)
- `src/data-analysis/templates/eval-dataset-extraction.ts` — Template #2 (3 user categories: question, request, other)

**Built-in templates:**

| Template | User Categories | Agent Roles |
|----------|----------------|-------------|
| CX Transcript Analysis | question, request, identity_info, confirmation, greeting, closing, uncategorized | response, proactive, procedural |
| Eval Dataset Extraction | question, request, other | response, proactive, procedural |

### Classification Output

The LLM returns a flat array via tool-use — one entry per message:

```typescript
// What the LLM returns (tool-use output)
interface LLMClassifiedMessage {
  messageId: number;
  label: string;                   // user category OR agent role (single field)
  intentOpenCode?: string;         // free-text AI-generated intent, only for question/request user messages
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;      // reconstructed full question (only when isFollowUp=true)
}

// What gets stored in the database (adds source tracking)
interface ClassifiedMessage extends LLMClassifiedMessage {
  source: "llm" | "human";        // defaults to "llm" on initial classification, "human" when manually edited
}
```

**Label field semantics:** Each message gets exactly one `label`. For user messages, the label is one of the template's `categories[].id` values (e.g., "question", "request"). For agent messages, the label is one of the template's `agentRoles[].id` values (e.g., "response", "proactive"). The LLM determines which set to use based on the message role in the input.

**`intentOpenCode` semantics:** A short snake_case phrase summarizing the user's specific intent (e.g., "pricing_inquiry", "plan_upgrade", "billing_dispute"). Generated only for user messages labeled "question" or "request". Not generated for greetings, closings, or agent messages.

### Classification Pass (Single LLM Call)

One call per conversation. The prompt is dynamically built from the template using `buildClassificationPrompt(template, messages)`.

**Prompt structure:**
1. Template categories with descriptions and few-shot examples
2. Agent role definitions
3. Disambiguation rules from template
4. Follow-up detection instructions
5. Standalone version reconstruction instructions (for follow-ups only)
6. Full conversation messages as JSON

**Output:** JSON array of `ClassifiedMessage` objects via tool-use.

**Key prompt improvements over current system:**
- Focused task: only per-message labeling (no exchange grouping)
- Few-shot examples for every category
- Explicit disambiguation rules (e.g., "If phrased as a question but intent is to trigger action → request")
- Agent messages get separate role labels, not user categories
- Follow-up detection with standalone reconstruction

### Block Grouping (Deterministic, No LLM)

After classification, messages are grouped into blocks in code:

**Rule:** A new block starts each time a user message appears after an agent message. Multiple consecutive user messages (before any agent response) stay in the same block.

```typescript
interface ConversationBlock {
  label: string;                   // the user message's category
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  messages: ClassifiedMessage[];   // user + agent messages in this block
}
```

**Grouping algorithm:**
1. Iterate messages in order
2. When a user message appears after an agent message → start new block
3. Multiple consecutive user messages before an agent → same block
4. Block label = the first user message's label (if multiple user messages in block)
5. Block inherits intentOpenCode, confidence, isFollowUp, followUpType, standaloneVersion from the first user message
6. Agent messages attach to the block they fall within
7. Edge case: if conversation starts with agent message(s) before any user message, those agent messages form the first block with label from the first user message that follows (or "uncategorized" if no user messages exist)

**Example:**
```
User: "Hi"              → block 1 (greeting)
Agent: "Welcome!"      → block 1
User: "5G plans?"      → block 2 (question, intent: pricing_inquiry)
Agent: "We have..."    → block 2
User: "Data limit?"    → block 3 (question, intent: data_limits, follow-up, standalone: "What is the data limit on the 5G Plus plan?")
Agent: "100GB..."      → block 3
```

### Inline Label Editing

Users can click any label badge in the accordion view to change it via dropdown. On edit:
1. The message's `source` field changes to `"human"`
2. Block grouping re-runs deterministically
3. The `standaloneVersion` is NOT automatically regenerated (user can edit it manually in the By Message Type view)

Edited labels are persisted in the database. The "edited" marker is visible in the UI.

---

## Frontend Design

### By Conversation View (Accordion)

The existing accordion card approach, enhanced with:

**Accordion header shows:**
- Category badge (clickable to edit)
- `intentOpenCode` as italic text
- Confidence dot (green = high, amber = low)
- "edited" marker if label was manually changed
- Message count

**Accordion body shows:**
- Chat bubbles (exact current styling)
- Agent role tag shown inline on agent bubble role line (e.g., "Sarah · #4 [response]")
- Extracted info pills at bottom for identity_info blocks

**Edit interaction:**
- Click the category badge → dropdown appears with all template categories
- Select a different category → label updates, blocks re-group, "edited" marker appears

### By Message Type View (Feed)

Sidebar lists categories with counts. Clicking a category shows a feed of all blocks of that type.

**Feed item (default/collapsed):**
- Metadata row: visitor name, conversation ID, `intentOpenCode` badge, "follow-up" badge if applicable, confidence dot
- Primary text: standalone version (for follow-ups) or original message (for standalone questions)
- Agent response below with role indicator

**Feed item (expanded, on click):**
- Preceding conversation context: all messages from the start of the conversation up to (but not including) the current block's messages
- Divider with "this message (original)" showing the raw user text
- Editable textarea with the standalone version (for follow-ups)
- Save/Cancel buttons
- For non-follow-ups: shows preceding context and original message only, no edit textarea

### Template Selector

Dropdown in the conversations toolbar, next to the batch Classify/Translate buttons. Selected template is stored per-classification run. Re-classifying with a different template replaces previous labels.

---

## Backend Changes

### Schema Updates (`schema.ts`)

Add to `livechatConversations` table:
- `templateId: v.optional(v.string())` — which template was used for classification
- `classifiedMessages: v.optional(v.array(v.object({ messageId: v.number(), label: v.string(), intentOpenCode: v.optional(v.string()), confidence: v.string(), isFollowUp: v.boolean(), followUpType: v.optional(v.string()), standaloneVersion: v.optional(v.string()), source: v.string() })))` — flat array of ClassifiedMessage
- `blocks: v.optional(v.array(v.object({ label: v.string(), intentOpenCode: v.optional(v.string()), confidence: v.string(), isFollowUp: v.boolean(), followUpType: v.optional(v.string()), standaloneVersion: v.optional(v.string()), messageIds: v.array(v.number()) })))` — computed block grouping (references message IDs, not full messages)

The current `messageTypes` field remains for backward compatibility. Frontend checks `classifiedMessages` first, falls back to `messageTypes`.

### Mutations

- `patchMessageLabel(conversationId, messageId, newLabel)` — updates a single message's label, sets source to "human", re-computes blocks
- `patchStandaloneVersion(conversationId, messageId, newText)` — updates standalone version text for a follow-up message

### Actions

- `classifyConversation` action updated to accept `templateId`, use the new prompt builder, return the new output format
- `classifyBatch` action updated to pass `templateId` through to each individual classification

### Preprocessing

Bot flow input detection (`parseBotFlowInput`) and system message filtering remain unchanged in the preprocessing step. Only human user/agent messages are sent to the LLM. The `max_tokens` for the LLM call increases from 4096 to 8192 to accommodate standalone version reconstruction.

---

## eval-lib Changes

### Files Modified

1. **`claude-client.ts`** — Replace hardcoded system prompt with `buildClassificationPrompt(template, messages)`. Tool schema outputs `ClassifiedMessage[]` instead of nested microtopic structure.

2. **`types.ts`** — Add: `ClassificationTemplate`, `CategoryDefinition`, `AgentRoleDefinition`, `ClassifiedMessage`, `ConversationBlock`. Deprecate: `MessageType`, `Exchange`, `LLMMicrotopicResult`.

3. **`message-type-classifier.ts`** — Update `classifyMessageTypes()` to accept template, return new format. Replace assembly phase with deterministic block grouper.

### Files Added

4. **`templates/index.ts`** — Template registry
5. **`templates/cx-transcript-analysis.ts`** — Template #1 with categories, few-shot examples, disambiguation rules
6. **`templates/eval-dataset-extraction.ts`** — Template #2
7. **`block-grouper.ts`** — Deterministic block grouping logic (pure function)
8. **`prompt-builder.ts`** — Builds system prompt from template definition

### Files Unchanged

- `transcript-parser.ts` — parsing stays the same
- `translator.ts` — translation is independent
- `csv-parser.ts` — CSV handling stays the same

---

## Frontend Changes

### Modified Components

1. **`ConversationsTab.tsx`** — Add template selector to toolbar, pass templateId to classify mutations
2. **`MessageTypeCard.tsx`** — Adapt to new block structure, add label edit dropdown, show intentOpenCode, confidence, agent roles, follow-up badge
3. **`MessageTypeFeed.tsx`** — Rewrite to show standalone versions, click-to-expand with context and edit
4. **`ConversationList.tsx`** — No significant changes (mini-badges already work)

### New Components

5. **`LabelEditDropdown.tsx`** — Reusable dropdown for changing message labels
6. **`FeedItemExpanded.tsx`** — Expanded view with preceding context, original message, editable standalone version

---

## Data Flow

```
1. User selects template + clicks "Classify"
2. Backend enqueues classification action with templateId
3. Action loads template → builds prompt → single LLM call
4. LLM returns ClassifiedMessage[] (per-message labels, intents, follow-up flags, standalone versions)
5. Action runs block grouper → produces ConversationBlock[]
6. Stores classifiedMessages + blocks in database
7. Frontend reactively updates accordion view
8. User can edit labels (mutation patches single message, re-runs grouper)
9. User can edit standalone versions (mutation patches text)
10. "By Message Type" view shows feed of standalone questions, click to expand context + edit
```

---

## Migration

The current `messageTypes` field on `livechatConversations` will be deprecated but not immediately removed. New classifications write to `classifiedMessages` + `blocks`. The frontend checks for the new fields first, falls back to old `messageTypes` for previously-classified conversations. A future migration can re-classify old conversations with the new system.
