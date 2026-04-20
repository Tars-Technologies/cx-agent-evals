# Classification System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded message classifier with a template-driven system that produces per-message labels, deterministic blocks, follow-up detection, standalone question reconstruction, and inline label editing.

**Architecture:** Template definitions (TypeScript objects) → prompt builder generates LLM prompt → single Claude call per conversation → flat `ClassifiedMessage[]` output → deterministic block grouper → stored in Convex. Frontend shows accordion cards (By Conversation) and a feed of standalone questions (By Message Type) with click-to-expand context and edit.

**Tech Stack:** TypeScript, Vitest, Anthropic SDK (tool-use), Convex (backend), React/Next.js (frontend)

**Spec:** `docs/superpowers/specs/2026-04-21-classification-system-redesign.md`

---

## File Map

### eval-lib (packages/eval-lib/src/data-analysis/)

| File | Action | Purpose |
|------|--------|---------|
| `types.ts` | Modify | Add ClassificationTemplate, ClassifiedMessage, ConversationBlock types |
| `templates/index.ts` | Create | Template registry + lookup |
| `templates/cx-transcript-analysis.ts` | Create | 7-category template with examples + disambiguation rules |
| `templates/eval-dataset-extraction.ts` | Create | 3-category template (question, request, other) |
| `prompt-builder.ts` | Create | Builds classification system prompt from template |
| `block-grouper.ts` | Create | Deterministic block grouping algorithm |
| `message-type-classifier.ts` | Modify | Update classifyMessageTypes() to use templates + new output |
| `claude-client.ts` | Modify | New tool schema, accepts dynamic prompt |
| `index.ts` | Modify | Export new public types and functions |

### backend (packages/backend/convex/livechat/)

| File | Action | Purpose |
|------|--------|---------|
| `../schema.ts` | Modify | Add classifiedMessages, blocks, templateId fields |
| `orchestration.ts` | Modify | Add templateId args, new patchMessageLabel/patchStandaloneVersion mutations |
| `actions.ts` | Modify | Pass templateId to classifier, store new format |

### frontend (packages/frontend/src/components/livechat/)

| File | Action | Purpose |
|------|--------|---------|
| `types.ts` | Modify | Add ClassifiedMessage, ConversationBlock frontend types |
| `ConversationsTab.tsx` | Modify | Add template selector, pass templateId |
| `MessageTypeCard.tsx` | Modify | Show new block data: intentOpenCode, confidence, agent roles, edit dropdown |
| `LabelEditDropdown.tsx` | Create | Reusable label edit dropdown component |
| `MessageTypeFeed.tsx` | Modify | Rewrite for standalone versions, click-to-expand |
| `FeedItemExpanded.tsx` | Create | Expanded view with context + edit |

---

## Task Sequence

### Task 1: Types and Template Interfaces

**Files:**
- Modify: `packages/eval-lib/src/data-analysis/types.ts`
- Test: `packages/eval-lib/tests/unit/data-analysis/classification-types.test.ts`

- [ ] **Step 1: Write type validation test**

```typescript
import { describe, it, expect } from "vitest";
import type {
  ClassificationTemplate,
  CategoryDefinition,
  AgentRoleDefinition,
  FewShotExample,
  LLMClassifiedMessage,
  ClassifiedMessage,
  ConversationBlock,
} from "../../../src/data-analysis/types.js";

describe("Classification types", () => {
  it("ClassifiedMessage extends LLMClassifiedMessage with source", () => {
    const llmMsg: LLMClassifiedMessage = {
      messageId: 1,
      label: "question",
      intentOpenCode: "pricing_inquiry",
      confidence: "high",
      isFollowUp: false,
    };
    const stored: ClassifiedMessage = { ...llmMsg, source: "llm" };
    expect(stored.source).toBe("llm");
    expect(stored.messageId).toBe(1);
  });

  it("ConversationBlock references message IDs", () => {
    const block: ConversationBlock = {
      label: "question",
      intentOpenCode: "pricing_inquiry",
      confidence: "high",
      isFollowUp: false,
      messageIds: [3, 4],
    };
    expect(block.messageIds).toHaveLength(2);
  });

  it("ClassificationTemplate has categories and agentRoles", () => {
    const tpl: ClassificationTemplate = {
      id: "test",
      name: "Test",
      description: "test template",
      categories: [{ id: "question", name: "Question", description: "A question", examples: [] }],
      agentRoles: [{ id: "response", name: "Response", description: "Agent responds" }],
      disambiguationRules: ["Rule 1"],
    };
    expect(tpl.categories).toHaveLength(1);
    expect(tpl.agentRoles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/classification-types.test.ts`
Expected: FAIL — types don't exist yet

- [ ] **Step 3: Add types to types.ts**

Add to `packages/eval-lib/src/data-analysis/types.ts`:

```typescript
// ── Classification Templates ──

export interface FewShotExample {
  message: string;
  role: "user" | "human_agent";
  context?: string;
}

export interface CategoryDefinition {
  id: string;
  name: string;
  description: string;
  examples: FewShotExample[];
  extractFields?: boolean;
}

export interface AgentRoleDefinition {
  id: string;
  name: string;
  description: string;
}

export interface ClassificationTemplate {
  id: string;
  name: string;
  description: string;
  categories: CategoryDefinition[];
  agentRoles: AgentRoleDefinition[];
  disambiguationRules: string[];
}

// ── Classification Output ──

export interface LLMClassifiedMessage {
  messageId: number;
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
}

export interface ClassifiedMessage extends LLMClassifiedMessage {
  source: "llm" | "human";
}

export interface ConversationBlock {
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  messageIds: number[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/classification-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/types.ts packages/eval-lib/tests/unit/data-analysis/classification-types.test.ts
git commit -m "feat(eval-lib): add classification template and output types"
```

---

### Task 2: Block Grouper (Pure Function)

**Files:**
- Create: `packages/eval-lib/src/data-analysis/block-grouper.ts`
- Test: `packages/eval-lib/tests/unit/data-analysis/block-grouper.test.ts`

- [ ] **Step 1: Write block grouper tests**

```typescript
import { describe, it, expect } from "vitest";
import { groupIntoBlocks } from "../../../src/data-analysis/block-grouper.js";
import type { ClassifiedMessage } from "../../../src/data-analysis/types.js";

describe("groupIntoBlocks", () => {
  it("groups user + agent into one block", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "pricing" },
      { messageId: 2, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("question");
    expect(blocks[0].intentOpenCode).toBe("pricing");
    expect(blocks[0].messageIds).toEqual([1, 2]);
  });

  it("starts new block when user message appears after agent", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "greeting", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 2, label: "procedural", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 3, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 4, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"], [3, "user"], [4, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].label).toBe("greeting");
    expect(blocks[1].label).toBe("question");
  });

  it("keeps consecutive user messages in same block", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 2, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 3, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "user"], [3, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].messageIds).toEqual([1, 2, 3]);
  });

  it("handles conversation starting with agent message", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "procedural", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 2, label: "greeting", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "human_agent"], [2, "user"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("greeting");
    expect(blocks[0].messageIds).toEqual([1, 2]);
  });

  it("propagates follow-up data from first user message", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "low", isFollowUp: true, followUpType: "clarification", standaloneVersion: "What is the data limit on 5G Plus?", source: "llm", intentOpenCode: "data_limits" },
      { messageId: 2, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks[0].isFollowUp).toBe(true);
    expect(blocks[0].followUpType).toBe("clarification");
    expect(blocks[0].standaloneVersion).toBe("What is the data limit on 5G Plus?");
    expect(blocks[0].confidence).toBe("low");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/block-grouper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement block-grouper.ts**

Create `packages/eval-lib/src/data-analysis/block-grouper.ts`:

```typescript
import type { ClassifiedMessage, ConversationBlock } from "./types.js";

/**
 * Groups classified messages into conversation blocks deterministically.
 *
 * Rules:
 * - New block starts when a user message appears after an agent message
 * - Consecutive user messages stay in the same block
 * - Block label/metadata comes from the first user message in the block
 * - If conversation starts with agent messages, they join the first block
 *
 * @param messages - Classified messages in conversation order
 * @param messageRoles - Map of messageId → original role ("user" | "human_agent" | "workflow_input")
 */
export function groupIntoBlocks(
  messages: ClassifiedMessage[],
  messageRoles: Map<number, string>,
): ConversationBlock[] {
  if (messages.length === 0) return [];

  const blocks: ConversationBlock[] = [];
  let currentBlock: { messageIds: number[]; firstUserMsg?: ClassifiedMessage } = {
    messageIds: [],
  };
  let lastRole: string | null = null;

  for (const msg of messages) {
    const role = messageRoles.get(msg.messageId) ?? "user";
    const isUser = role === "user";

    // Start new block when user message appears after agent message
    if (isUser && lastRole === "human_agent" && currentBlock.messageIds.length > 0) {
      // Flush current block
      if (currentBlock.firstUserMsg) {
        blocks.push(buildBlock(currentBlock.firstUserMsg, currentBlock.messageIds));
      }
      currentBlock = { messageIds: [], firstUserMsg: undefined };
    }

    currentBlock.messageIds.push(msg.messageId);
    if (isUser && !currentBlock.firstUserMsg) {
      currentBlock.firstUserMsg = msg;
    }

    lastRole = role;
  }

  // Flush final block
  if (currentBlock.messageIds.length > 0 && currentBlock.firstUserMsg) {
    blocks.push(buildBlock(currentBlock.firstUserMsg, currentBlock.messageIds));
  } else if (currentBlock.messageIds.length > 0) {
    // Edge case: only agent messages, no user messages at all
    blocks.push({
      label: "uncategorized",
      confidence: "high",
      isFollowUp: false,
      messageIds: currentBlock.messageIds,
    });
  }

  return blocks;
}

function buildBlock(anchor: ClassifiedMessage, messageIds: number[]): ConversationBlock {
  return {
    label: anchor.label,
    intentOpenCode: anchor.intentOpenCode,
    confidence: anchor.confidence,
    isFollowUp: anchor.isFollowUp,
    followUpType: anchor.followUpType,
    standaloneVersion: anchor.standaloneVersion,
    messageIds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/block-grouper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/block-grouper.ts packages/eval-lib/tests/unit/data-analysis/block-grouper.test.ts
git commit -m "feat(eval-lib): add deterministic block grouper"
```

---

### Task 3: Classification Templates

**Files:**
- Create: `packages/eval-lib/src/data-analysis/templates/index.ts`
- Create: `packages/eval-lib/src/data-analysis/templates/cx-transcript-analysis.ts`
- Create: `packages/eval-lib/src/data-analysis/templates/eval-dataset-extraction.ts`
- Test: `packages/eval-lib/tests/unit/data-analysis/templates.test.ts`

- [ ] **Step 1: Write template registry tests**

```typescript
import { describe, it, expect } from "vitest";
import { getTemplate, listTemplates } from "../../../src/data-analysis/templates/index.js";

describe("Template Registry", () => {
  it("lists all built-in templates", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(2);
    expect(templates.map(t => t.id)).toContain("cx-transcript-analysis");
    expect(templates.map(t => t.id)).toContain("eval-dataset-extraction");
  });

  it("gets template by ID", () => {
    const tpl = getTemplate("cx-transcript-analysis");
    expect(tpl).toBeDefined();
    expect(tpl!.categories.length).toBe(7);
    expect(tpl!.agentRoles.length).toBe(3);
    expect(tpl!.disambiguationRules.length).toBeGreaterThan(0);
  });

  it("returns undefined for unknown template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });

  it("cx-transcript-analysis has few-shot examples for each category", () => {
    const tpl = getTemplate("cx-transcript-analysis")!;
    for (const cat of tpl.categories) {
      expect(cat.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("eval-dataset-extraction has 3 categories", () => {
    const tpl = getTemplate("eval-dataset-extraction")!;
    expect(tpl.categories.map(c => c.id)).toEqual(["question", "request", "other"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create CX Transcript Analysis template**

Create `packages/eval-lib/src/data-analysis/templates/cx-transcript-analysis.ts`:

```typescript
import type { ClassificationTemplate } from "../types.js";

export const CX_TRANSCRIPT_ANALYSIS: ClassificationTemplate = {
  id: "cx-transcript-analysis",
  name: "CX Transcript Analysis",
  description: "Full 7-category breakdown for customer support conversation analysis",
  categories: [
    {
      id: "question",
      name: "Question",
      description: "User asks a factual question seeking information about products, services, pricing, plans, coverage, features, policies, or procedures.",
      examples: [
        { message: "What are the available 5G plans and their prices?", role: "user" },
        { message: "Does my plan include international roaming?", role: "user" },
        { message: "How long does it take to process a refund?", role: "user" },
      ],
    },
    {
      id: "request",
      name: "Request",
      description: "User wants an action performed: activate/deactivate a service, upgrade/downgrade a plan, get a refund, book an appointment, change settings, or any task that requires the agent to DO something (not just inform).",
      examples: [
        { message: "I'd like to upgrade to the Plus plan please", role: "user" },
        { message: "Can you activate international roaming on my number?", role: "user" },
        { message: "Please cancel my subscription", role: "user" },
      ],
    },
    {
      id: "identity_info",
      name: "Identity Info",
      description: "User shares personal identifying information (name, phone, email, address, ID number) or agent asks for/confirms it.",
      examples: [
        { message: "+974 5512 3456", role: "user" },
        { message: "My name is Ahmed Al-Thani", role: "user" },
        { message: "Can I get your phone number to look up your account?", role: "human_agent" },
      ],
      extractFields: true,
    },
    {
      id: "confirmation",
      name: "Confirmation",
      description: "Simple acknowledgments, yes/no responses, brief confirmations that don't introduce new information or requests.",
      examples: [
        { message: "Yes, that's correct", role: "user" },
        { message: "OK", role: "user" },
        { message: "Got it, thanks", role: "user" },
      ],
    },
    {
      id: "greeting",
      name: "Greeting",
      description: "Hello/welcome/how-are-you exchanges at the start of a conversation. Does NOT include questions that happen to be polite (those are questions).",
      examples: [
        { message: "Hi, good morning", role: "user" },
        { message: "Hello", role: "user" },
      ],
    },
    {
      id: "closing",
      name: "Closing",
      description: "Thank you/goodbye/session-end exchanges.",
      examples: [
        { message: "Great, thank you so much!", role: "user" },
        { message: "That's all I needed, bye", role: "user" },
      ],
    },
    {
      id: "uncategorized",
      name: "Uncategorized",
      description: "Messages that don't clearly fit any other category. Use sparingly — prefer a specific category when possible.",
      examples: [
        { message: "hmm", role: "user" },
        { message: "...", role: "user" },
      ],
    },
  ],
  agentRoles: [
    {
      id: "response",
      name: "Response",
      description: "Agent responds to a user's question or request with information or action confirmation.",
    },
    {
      id: "proactive",
      name: "Proactive",
      description: "Agent initiates: asks for information, offers something unsolicited, requests verification.",
    },
    {
      id: "procedural",
      name: "Procedural",
      description: "Scripted/template messages: greetings, closings, hold messages, transfer notifications.",
    },
  ],
  disambiguationRules: [
    "If a message is phrased as a question but the user's clear intent is to trigger an action (e.g., 'Can you upgrade my plan?'), classify as 'request'.",
    "If a message includes both a question and a request, classify based on the PRIMARY intent. 'What plans do you have and can you switch me?' → 'request' (the switch is the goal).",
    "Politeness formulas like 'Can you help me?' at conversation start are 'greeting', not 'question'.",
    "'How are you?' is 'greeting'. 'How do I reset my password?' is 'question'.",
    "Simple 'yes'/'no'/'ok' after an agent asks something is 'confirmation', not 'request'.",
    "If ambiguous between 'question' and 'confirmation', prefer 'confirmation' for short messages (under 5 words) that follow an agent message.",
  ],
};
```

- [ ] **Step 4: Create Eval Dataset Extraction template**

Create `packages/eval-lib/src/data-analysis/templates/eval-dataset-extraction.ts`:

```typescript
import type { ClassificationTemplate } from "../types.js";

export const EVAL_DATASET_EXTRACTION: ClassificationTemplate = {
  id: "eval-dataset-extraction",
  name: "Eval Dataset Extraction",
  description: "Focused classification for extracting questions and requests to build RAG evaluation datasets",
  categories: [
    {
      id: "question",
      name: "Question",
      description: "User asks a factual question seeking information. These become eval dataset entries: real questions that an AI agent should be able to answer from a knowledge base.",
      examples: [
        { message: "What are the available 5G plans and their prices?", role: "user" },
        { message: "Does my plan include international roaming?", role: "user" },
        { message: "How long does it take to process a refund?", role: "user" },
      ],
    },
    {
      id: "request",
      name: "Request",
      description: "User wants an action performed. These represent tasks an AI agent should handle: activating services, processing changes, scheduling appointments.",
      examples: [
        { message: "I'd like to upgrade to the Plus plan please", role: "user" },
        { message: "Can you activate international roaming on my number?", role: "user" },
        { message: "Please cancel my subscription", role: "user" },
      ],
    },
    {
      id: "other",
      name: "Other",
      description: "Everything else: greetings, closings, confirmations, identity info, small talk. Not useful for eval dataset extraction.",
      examples: [
        { message: "Hi, good morning", role: "user" },
        { message: "Yes, that's correct", role: "user" },
        { message: "+974 5512 3456", role: "user" },
        { message: "Thank you, goodbye", role: "user" },
      ],
    },
  ],
  agentRoles: [
    { id: "response", name: "Response", description: "Agent responds to user's question or request." },
    { id: "proactive", name: "Proactive", description: "Agent initiates: asks for info, offers something." },
    { id: "procedural", name: "Procedural", description: "Scripted messages: greetings, closings, holds." },
  ],
  disambiguationRules: [
    "If phrased as a question but intent is action → 'request'.",
    "If both question and request in one message → 'request' (action is primary).",
    "Greetings, closings, confirmations, identity sharing → all are 'other'.",
    "When uncertain between 'question' and 'other': if it could generate a useful eval test case, it's a 'question'.",
  ],
};
```

- [ ] **Step 5: Create template registry**

Create `packages/eval-lib/src/data-analysis/templates/index.ts`:

```typescript
import type { ClassificationTemplate } from "../types.js";
import { CX_TRANSCRIPT_ANALYSIS } from "./cx-transcript-analysis.js";
import { EVAL_DATASET_EXTRACTION } from "./eval-dataset-extraction.js";

const TEMPLATES: ClassificationTemplate[] = [
  CX_TRANSCRIPT_ANALYSIS,
  EVAL_DATASET_EXTRACTION,
];

const TEMPLATE_MAP = new Map(TEMPLATES.map(t => [t.id, t]));

export function listTemplates(): ClassificationTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: string): ClassificationTemplate | undefined {
  return TEMPLATE_MAP.get(id);
}

export { CX_TRANSCRIPT_ANALYSIS, EVAL_DATASET_EXTRACTION };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/templates.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/eval-lib/src/data-analysis/templates/
git add packages/eval-lib/tests/unit/data-analysis/templates.test.ts
git commit -m "feat(eval-lib): add classification templates with few-shot examples"
```

---

### Task 4: Prompt Builder

**Files:**
- Create: `packages/eval-lib/src/data-analysis/prompt-builder.ts`
- Test: `packages/eval-lib/tests/unit/data-analysis/prompt-builder.test.ts`

- [ ] **Step 1: Write prompt builder tests**

```typescript
import { describe, it, expect } from "vitest";
import { buildClassificationPrompt, buildToolSchema } from "../../../src/data-analysis/prompt-builder.js";
import { CX_TRANSCRIPT_ANALYSIS } from "../../../src/data-analysis/templates/index.js";

describe("buildClassificationPrompt", () => {
  it("includes all category descriptions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("question");
    expect(prompt).toContain("request");
    expect(prompt).toContain("identity_info");
    expect(prompt).toContain("greeting");
    expect(prompt).toContain("closing");
    expect(prompt).toContain("confirmation");
    expect(prompt).toContain("uncategorized");
  });

  it("includes few-shot examples", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("What are the available 5G plans");
    expect(prompt).toContain("I'd like to upgrade");
  });

  it("includes disambiguation rules", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("phrased as a question but");
  });

  it("includes agent role definitions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("response");
    expect(prompt).toContain("proactive");
    expect(prompt).toContain("procedural");
  });

  it("includes follow-up detection instructions", () => {
    const prompt = buildClassificationPrompt(CX_TRANSCRIPT_ANALYSIS);
    expect(prompt).toContain("isFollowUp");
    expect(prompt).toContain("standaloneVersion");
  });
});

describe("buildToolSchema", () => {
  it("returns valid tool schema with enum from template", () => {
    const schema = buildToolSchema(CX_TRANSCRIPT_ANALYSIS);
    expect(schema.name).toBe("classify_messages");
    const labelEnum = schema.input_schema.properties.messages.items.properties.label.enum;
    expect(labelEnum).toContain("question");
    expect(labelEnum).toContain("response");
    expect(labelEnum).toContain("proactive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/prompt-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement prompt-builder.ts**

Create `packages/eval-lib/src/data-analysis/prompt-builder.ts`:

```typescript
import type { ClassificationTemplate } from "./types.js";

export function buildClassificationPrompt(template: ClassificationTemplate): string {
  const sections: string[] = [];

  sections.push(`You are classifying customer support chat messages. Each message gets exactly one label.`);
  sections.push(``);

  // User categories
  sections.push(`## User Message Categories`);
  sections.push(`For messages from the user, assign one of these labels:`);
  sections.push(``);
  for (const cat of template.categories) {
    sections.push(`### ${cat.id}`);
    sections.push(cat.description);
    if (cat.examples.length > 0) {
      sections.push(`Examples:`);
      for (const ex of cat.examples) {
        sections.push(`- "${ex.message}" (${ex.role})`);
      }
    }
    sections.push(``);
  }

  // Agent roles
  sections.push(`## Agent Message Roles`);
  sections.push(`For messages from the agent (human_agent), assign one of these labels:`);
  sections.push(``);
  for (const role of template.agentRoles) {
    sections.push(`### ${role.id}`);
    sections.push(role.description);
    sections.push(``);
  }

  // Disambiguation rules
  sections.push(`## Disambiguation Rules`);
  for (const rule of template.disambiguationRules) {
    sections.push(`- ${rule}`);
  }
  sections.push(``);

  // Follow-up detection
  sections.push(`## Follow-Up Detection`);
  sections.push(`For each user message labeled "question" or "request", determine if it is a follow-up to a previous exchange in the same conversation.`);
  sections.push(`A message is a follow-up if it:`);
  sections.push(`- References something discussed earlier ("that", "this", "the same one")`);
  sections.push(`- Would be unclear or ambiguous without the preceding context`);
  sections.push(`- Corrects or clarifies a previous message`);
  sections.push(`- Provides feedback on the agent's previous response`);
  sections.push(``);
  sections.push(`If isFollowUp is true, set followUpType to one of: "clarification", "correction", "feedback"`);
  sections.push(`If isFollowUp is true, also provide standaloneVersion: rewrite the message as a complete, self-contained question/request that includes all necessary context from the conversation. It should read as if the user asked it without any prior conversation. Keep it crisp and natural — like a real user would phrase it.`);
  sections.push(``);

  // Intent open code
  sections.push(`## Intent Open Code`);
  sections.push(`For user messages labeled "question" or "request", generate an intentOpenCode: a short snake_case phrase (2-4 words) summarizing the specific intent. Examples: "pricing_inquiry", "plan_upgrade", "billing_dispute", "coverage_area", "esim_activation".`);
  sections.push(``);

  // Confidence
  sections.push(`## Confidence`);
  sections.push(`Set confidence to "high" when you are certain of the classification. Set to "low" when the message is ambiguous or could reasonably belong to a different category.`);

  return sections.join("\n");
}

export function buildToolSchema(template: ClassificationTemplate) {
  const allLabels = [
    ...template.categories.map(c => c.id),
    ...template.agentRoles.map(r => r.id),
  ];

  return {
    name: "classify_messages",
    description: "Classify each message in the conversation",
    input_schema: {
      type: "object" as const,
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              messageId: { type: "number" },
              label: { type: "string", enum: allLabels },
              intentOpenCode: { type: "string" },
              confidence: { type: "string", enum: ["high", "low"] },
              isFollowUp: { type: "boolean" },
              followUpType: { type: "string", enum: ["clarification", "correction", "feedback"] },
              standaloneVersion: { type: "string" },
            },
            required: ["messageId", "label", "confidence", "isFollowUp"],
          },
        },
      },
      required: ["messages"],
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/data-analysis/prompt-builder.ts packages/eval-lib/tests/unit/data-analysis/prompt-builder.test.ts
git commit -m "feat(eval-lib): add prompt builder for template-driven classification"
```

---

### Task 5: Update Claude Client and Classifier

**Files:**
- Modify: `packages/eval-lib/src/data-analysis/claude-client.ts`
- Modify: `packages/eval-lib/src/data-analysis/message-type-classifier.ts`
- Modify: `packages/eval-lib/src/data-analysis/index.ts`
- Test: `packages/eval-lib/tests/unit/data-analysis/message-type-classifier.test.ts`

- [ ] **Step 1: Write integration test for new classifier**

```typescript
import { describe, it, expect, vi } from "vitest";
import { classifyMessageTypes } from "../../../src/data-analysis/message-type-classifier.js";
import type { RawConversation } from "../../../src/data-analysis/types.js";

// Mock the Anthropic client
const mockCreate = vi.fn();
const mockClient = { messages: { create: mockCreate } } as any;

describe("classifyMessageTypes (new format)", () => {
  it("returns classifiedMessages and blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          messages: [
            { messageId: 1, label: "procedural", confidence: "high", isFollowUp: false },
            { messageId: 2, label: "greeting", confidence: "high", isFollowUp: false },
            { messageId: 3, label: "question", confidence: "high", isFollowUp: false, intentOpenCode: "pricing_inquiry" },
            { messageId: 4, label: "response", confidence: "high", isFollowUp: false },
          ],
        },
      }],
    });

    const conv: RawConversation = {
      conversationId: "test-1",
      visitorId: "v1", visitorName: "Ahmed", visitorPhone: "", visitorEmail: "",
      agentId: "a1", agentName: "Sarah", agentEmail: "",
      inbox: "support", labels: [], status: "resolved",
      messages: [
        { id: 1, role: "human_agent", text: "Welcome!" },
        { id: 2, role: "user", text: "Hi" },
        { id: 3, role: "user", text: "What are the 5G plans?" },
        { id: 4, role: "human_agent", text: "We have Basic, Plus, Premium." },
      ],
      metadata: {} as any,
    };

    const result = await classifyMessageTypes(conv, {
      claudeClient: mockClient,
      templateId: "cx-transcript-analysis",
    });

    expect(result.classifiedMessages).toHaveLength(4);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].label).toBe("greeting");
    expect(result.blocks[1].label).toBe("question");
    expect(result.blocks[1].intentOpenCode).toBe("pricing_inquiry");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/message-type-classifier.test.ts`
Expected: FAIL — old signature

- [ ] **Step 3: Update claude-client.ts**

Replace the contents of `packages/eval-lib/src/data-analysis/claude-client.ts`. The old hardcoded `SYSTEM_PROMPT` and `TOOL_SCHEMA` are removed. The new `classifyConversation` accepts prompt and schema as parameters. `createClaudeClient` is unchanged.

Note: The old `classifyConversation(client, messages, retries)` signature is removed. The deprecated `extractMicrotopics` function in `message-type-classifier.ts` will also be removed (it uses the old signature). Any code that called the old function must use the new `classifyMessageTypes` entry point.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { LLMClassifiedMessage, RawMessage } from "./types.js";

export function createClaudeClient(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
  }
  return new Anthropic({ apiKey: key });
}

/**
 * Classify conversation messages using a template-generated prompt.
 * Returns per-message classification results.
 */
export async function classifyConversation(
  client: Anthropic,
  messages: RawMessage[],
  systemPrompt: string,
  toolSchema: any,
  retries = 3,
): Promise<LLMClassifiedMessage[]> {
  const userContent = `Messages:\n${JSON.stringify(
    messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
  )}\n\nClassify each message using the classify_messages tool.`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [toolSchema],
        tool_choice: { type: "tool", name: "classify_messages" },
        messages: [{ role: "user", content: userContent }],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in response");
      }

      const raw = toolBlock.input as { messages: LLMClassifiedMessage[] };
      return raw.messages;
    } catch (err: any) {
      if (attempt < retries && err?.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Exhausted retries");
}
```

- [ ] **Step 4: Update message-type-classifier.ts**

Rewrite `classifyMessageTypes` in `packages/eval-lib/src/data-analysis/message-type-classifier.ts` to use the new template system:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import { parseBotFlowInput } from "./transcript-parser.js";
import { classifyConversation } from "./claude-client.js";
import { buildClassificationPrompt, buildToolSchema } from "./prompt-builder.js";
import { groupIntoBlocks } from "./block-grouper.js";
import { getTemplate } from "./templates/index.js";
import type {
  RawConversation,
  RawMessage,
  BotFlowInput,
  ClassifiedMessage,
  ConversationBlock,
  LLMClassifiedMessage,
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

// ── Preprocessing (unchanged logic) ──
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

    if (i === 0 && msg.role === "workflow_input") {
      const parsed = parseBotFlowInput(msg.text);
      if (parsed.language !== "unknown" || parsed.intent !== "unknown") {
        botFlowInput = { ...parsed, messageIds: [msg.id] };
        continue;
      }
    }

    if (msg.role === "workflow_input" && isSystemMessage(msg.text)) {
      systemMessageIds.add(msg.id);
      continue;
    }

    if (msg.role === "workflow_input") {
      if (i === 0) {
        botFlowInput = { ...parseBotFlowInput(msg.text), messageIds: [msg.id] };
        continue;
      }
      systemMessageIds.add(msg.id);
      continue;
    }

    llmInputMessages.push(msg);
  }

  return { botFlowInput, systemMessageIds, llmInputMessages, skipLLM: llmInputMessages.length === 0 };
}

// ── New classifier entry point ──
export interface ClassificationResult {
  classifiedMessages: ClassifiedMessage[];
  blocks: ConversationBlock[];
  botFlowInput?: BotFlowInput;
}

export async function classifyMessageTypes(
  conversation: RawConversation,
  options: {
    claudeClient: Anthropic;
    templateId: string;
  },
): Promise<ClassificationResult> {
  const template = getTemplate(options.templateId);
  if (!template) throw new Error(`Unknown template: ${options.templateId}`);

  const preprocess = preprocessConversation(conversation);

  let llmMessages: LLMClassifiedMessage[] = [];
  if (!preprocess.skipLLM) {
    const systemPrompt = buildClassificationPrompt(template);
    const toolSchema = buildToolSchema(template);
    llmMessages = await classifyConversation(
      options.claudeClient,
      preprocess.llmInputMessages,
      systemPrompt,
      toolSchema,
    );
  }

  // Convert to ClassifiedMessage (add source)
  const classifiedMessages: ClassifiedMessage[] = llmMessages.map(m => ({
    ...m,
    source: "llm" as const,
  }));

  // Build role map for block grouper
  const roleMap = new Map<number, string>();
  for (const msg of preprocess.llmInputMessages) {
    roleMap.set(msg.id, msg.role);
  }

  const blocks = groupIntoBlocks(classifiedMessages, roleMap);

  return {
    classifiedMessages,
    blocks,
    botFlowInput: preprocess.botFlowInput,
  };
}
```

- [ ] **Step 5: Update index.ts exports**

Add to `packages/eval-lib/src/data-analysis/index.ts`:

```typescript
export { groupIntoBlocks } from "./block-grouper.js";
export { buildClassificationPrompt, buildToolSchema } from "./prompt-builder.js";
export { listTemplates, getTemplate } from "./templates/index.js";
export type {
  ClassificationTemplate,
  CategoryDefinition,
  AgentRoleDefinition,
  FewShotExample,
  LLMClassifiedMessage,
  ClassifiedMessage,
  ConversationBlock,
} from "./types.js";
```

- [ ] **Step 6: Run all data-analysis tests**

Run: `cd packages/eval-lib && pnpm test -- tests/unit/data-analysis/`
Expected: PASS (all tests including the new classifier test)

- [ ] **Step 7: Commit**

```bash
git add packages/eval-lib/src/data-analysis/
git add packages/eval-lib/tests/unit/data-analysis/message-type-classifier.test.ts
git commit -m "feat(eval-lib): rewrite classifier to use templates, new output format"
```

---

### Task 6: Backend Schema and Mutations

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/livechat/orchestration.ts`
- Modify: `packages/backend/convex/livechat/actions.ts`

- [ ] **Step 1: Add new fields to schema**

In `packages/backend/convex/schema.ts`, add these fields to the `livechatConversations` table definition (after `messageTypes`):

```typescript
  templateId: v.optional(v.string()),
  classifiedMessages: v.optional(v.array(v.object({
    messageId: v.number(),
    label: v.string(),
    intentOpenCode: v.optional(v.string()),
    confidence: v.string(),
    isFollowUp: v.boolean(),
    followUpType: v.optional(v.string()),
    standaloneVersion: v.optional(v.string()),
    source: v.string(),
  }))),
  blocks: v.optional(v.array(v.object({
    label: v.string(),
    intentOpenCode: v.optional(v.string()),
    confidence: v.string(),
    isFollowUp: v.boolean(),
    followUpType: v.optional(v.string()),
    standaloneVersion: v.optional(v.string()),
    messageIds: v.array(v.number()),
  }))),
```

- [ ] **Step 2: Add templateId arg to classifySingle and classifyBatch**

In `packages/backend/convex/livechat/orchestration.ts`, update the mutations to accept `templateId`:

For `classifySingle`:
```typescript
args: {
  conversationId: v.id("livechatConversations"),
  templateId: v.optional(v.string()),
},
```
Pass `templateId: args.templateId ?? "cx-transcript-analysis"` to the action args.

For `classifyBatch`:
```typescript
args: {
  uploadId: v.id("livechatUploads"),
  conversationIds: v.array(v.id("livechatConversations")),
  templateId: v.optional(v.string()),
},
```
Pass `templateId: args.templateId ?? "cx-transcript-analysis"` to the action args.

- [ ] **Step 3: Add patchMessageLabel mutation**

Add to `packages/backend/convex/livechat/orchestration.ts`.

Note: `groupIntoBlocks` is a pure function (no Node deps) but is in eval-lib which may not be importable in Convex mutations. To avoid bundler issues, **inline** a simplified block grouper in the mutation file (or create a small `lib/blockGrouper.ts` in the convex directory). The logic is simple enough (~30 lines) to duplicate:

```typescript
// Add at top of orchestration.ts (or in convex/lib/blockGrouper.ts):
function recomputeBlocks(
  classifiedMessages: Array<{ messageId: number; label: string; intentOpenCode?: string; confidence: string; isFollowUp: boolean; followUpType?: string; standaloneVersion?: string; source: string }>,
  conversationMessages: Array<{ id: number; role: string }>,
) {
  const roleMap = new Map(conversationMessages.map(m => [m.id, m.role]));
  const blocks: Array<{ label: string; intentOpenCode?: string; confidence: string; isFollowUp: boolean; followUpType?: string; standaloneVersion?: string; messageIds: number[] }> = [];
  let current: { messageIds: number[]; anchor?: typeof classifiedMessages[0] } = { messageIds: [] };
  let lastRole: string | null = null;

  for (const msg of classifiedMessages) {
    const role = roleMap.get(msg.messageId) ?? "user";
    const isUser = role === "user";
    if (isUser && lastRole === "human_agent" && current.messageIds.length > 0) {
      if (current.anchor) blocks.push({ label: current.anchor.label, intentOpenCode: current.anchor.intentOpenCode, confidence: current.anchor.confidence, isFollowUp: current.anchor.isFollowUp, followUpType: current.anchor.followUpType, standaloneVersion: current.anchor.standaloneVersion, messageIds: current.messageIds });
      current = { messageIds: [] };
    }
    current.messageIds.push(msg.messageId);
    if (isUser && !current.anchor) current.anchor = msg;
    lastRole = role;
  }
  if (current.messageIds.length > 0 && current.anchor) {
    blocks.push({ label: current.anchor.label, intentOpenCode: current.anchor.intentOpenCode, confidence: current.anchor.confidence, isFollowUp: current.anchor.isFollowUp, followUpType: current.anchor.followUpType, standaloneVersion: current.anchor.standaloneVersion, messageIds: current.messageIds });
  }
  return blocks;
}

export const patchMessageLabel = mutation({
  args: {
    conversationId: v.id("livechatConversations"),
    messageId: v.number(),
    newLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.orgId !== orgId) throw new Error("Not found");
    if (!conv.classifiedMessages) throw new Error("Not classified");

    const updated = (conv.classifiedMessages as any[]).map((m) =>
      m.messageId === args.messageId ? { ...m, label: args.newLabel, source: "human" } : m
    );

    const blocks = recomputeBlocks(updated, conv.messages);
    await ctx.db.patch(args.conversationId, { classifiedMessages: updated, blocks });
  },
});
```

- [ ] **Step 4: Add patchStandaloneVersion mutation**

Add to `packages/backend/convex/livechat/orchestration.ts` (uses the same `recomputeBlocks` helper from step 3):

```typescript
export const patchStandaloneVersion = mutation({
  args: {
    conversationId: v.id("livechatConversations"),
    messageId: v.number(),
    standaloneVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.orgId !== orgId) throw new Error("Not found");
    if (!conv.classifiedMessages) throw new Error("Not classified");

    const updated = (conv.classifiedMessages as any[]).map((m) =>
      m.messageId === args.messageId ? { ...m, standaloneVersion: args.standaloneVersion, source: "human" } : m
    );

    const blocks = recomputeBlocks(updated, conv.messages);
    await ctx.db.patch(args.conversationId, { classifiedMessages: updated, blocks });
  },
});
```

- [ ] **Step 5: Update classifyConversations action**

In `packages/backend/convex/livechat/actions.ts`, update the action args and the `processOne` function:

1. Add `templateId: v.optional(v.string())` to the action args
2. Default `templateId` at the start: `const templateId = args.templateId ?? "cx-transcript-analysis";`
3. Change the `classifyMessageTypes` call inside `processOne`:

```typescript
// Replace:
const result = await classifyMessageTypes(rawConv, { claudeClient: client });
// With:
const result = await classifyMessageTypes(rawConv, { claudeClient: client, templateId });
```

4. Update the `patchClassificationStatus` call to store new fields:

```typescript
await ctx.runMutation(
  internal.livechat.orchestration.patchClassificationStatus,
  {
    conversationId: convId,
    status: "done",
    messageTypes: result.blocks, // backward compat for old frontend code
    classifiedMessages: result.classifiedMessages,
    blocks: result.blocks,
    templateId,
  },
);
```

5. Update the import at the top of the file to use the new signature:
```typescript
import { classifyMessageTypes } from "rag-evaluation-system/data-analysis";
```

- [ ] **Step 6: Update patchClassificationStatus to accept new fields**

In `orchestration.ts`, find the `patchClassificationStatus` internal mutation and add these to its `args`:

```typescript
classifiedMessages: v.optional(v.any()),
blocks: v.optional(v.any()),
templateId: v.optional(v.string()),
```

In the handler, include them in the patch when present:

```typescript
const patch: any = { classificationStatus: args.status };
if (args.messageTypes !== undefined) patch.messageTypes = args.messageTypes;
if (args.classifiedMessages !== undefined) patch.classifiedMessages = args.classifiedMessages;
if (args.blocks !== undefined) patch.blocks = args.blocks;
if (args.templateId !== undefined) patch.templateId = args.templateId;
if (args.error !== undefined) patch.classificationError = args.error;
await ctx.db.patch(args.conversationId, patch);
```

Also update the WorkPool `enqueueAction` calls in `classifySingle` and `classifyBatch` to pass `templateId` in the action args:

```typescript
// In classifySingle:
const workId = await pool.enqueueAction(
  ctx,
  internal.livechat.actions.classifyConversations,
  { conversationIds: [args.conversationId], templateId: args.templateId ?? "cx-transcript-analysis" },
  { ... },
);

// In classifyBatch:
const workId = await pool.enqueueAction(
  ctx,
  internal.livechat.actions.classifyConversations,
  { conversationIds: args.conversationIds, templateId: args.templateId ?? "cx-transcript-analysis" },
  { ... },
);
```

- [ ] **Step 7: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deploys successfully

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/livechat/
git commit -m "feat(backend): add template-driven classification schema and mutations"
```

---

### Task 7: Frontend — Template Selector and Label Editing

**Files:**
- Modify: `packages/frontend/src/components/livechat/types.ts`
- Modify: `packages/frontend/src/components/livechat/ConversationsTab.tsx`
- Create: `packages/frontend/src/components/livechat/LabelEditDropdown.tsx`
- Modify: `packages/frontend/src/components/livechat/MessageTypeCard.tsx`

- [ ] **Step 1: Update frontend types**

Add to `packages/frontend/src/components/livechat/types.ts`:

```typescript
export interface ClassifiedMessage {
  messageId: number;
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  source: "llm" | "human";
}

export interface ConversationBlock {
  label: string;
  intentOpenCode?: string;
  confidence: "high" | "low";
  isFollowUp: boolean;
  followUpType?: "clarification" | "correction" | "feedback";
  standaloneVersion?: string;
  messageIds: number[];
}

export const TEMPLATE_OPTIONS = [
  { id: "cx-transcript-analysis", name: "CX Transcript Analysis" },
  { id: "eval-dataset-extraction", name: "Eval Dataset Extraction" },
] as const;
```

- [ ] **Step 2: Create LabelEditDropdown component**

Create `packages/frontend/src/components/livechat/LabelEditDropdown.tsx`:

```typescript
"use client";

import { useState, useRef, useEffect } from "react";

const CATEGORY_COLORS: Record<string, string> = {
  question: "bg-[#22d3ee]",
  request: "bg-[#818cf8]",
  identity_info: "bg-[#fbbf24]",
  confirmation: "bg-[#8888a0]",
  greeting: "bg-[#6ee7b7]",
  closing: "bg-[#c084fc]",
  uncategorized: "bg-[#55556a]",
  other: "bg-[#55556a]",
};

export function LabelEditDropdown({
  currentLabel,
  categories,
  onSelect,
}: {
  currentLabel: string;
  categories: string[];
  onSelect: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-[9px] px-1.5 py-0 rounded border border-transparent hover:border-border-bright cursor-pointer"
      >
        {currentLabel}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border-bright rounded-md p-0.5 min-w-[120px] shadow-lg">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => { onSelect(cat); setOpen(false); }}
              className={`w-full text-left px-2 py-1 rounded text-[9px] flex items-center gap-1.5 ${
                cat === currentLabel ? "text-accent" : "text-text-muted hover:bg-bg-hover hover:text-text"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_COLORS[cat] ?? "bg-text-dim"}`} />
              {cat}
              {cat === currentLabel && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add template selector to ConversationsTab**

In `packages/frontend/src/components/livechat/ConversationsTab.tsx`, add state and UI:

```typescript
// Add state
const [templateId, setTemplateId] = useState("cx-transcript-analysis");

// In the toolbar, add before the "Select Conversations" button:
<select
  value={templateId}
  onChange={(e) => setTemplateId(e.target.value)}
  className="bg-bg-surface border border-border rounded px-2 py-0.5 text-[10px] text-text"
>
  <option value="cx-transcript-analysis">CX Transcript Analysis</option>
  <option value="eval-dataset-extraction">Eval Dataset Extraction</option>
</select>

// Pass templateId to classify mutations:
classifySingle({ conversationId: selectedConvId!, templateId });
classifyBatch({ uploadId, conversationIds: ids, templateId });
```

- [ ] **Step 4: Update MessageTypeCard for new block format**

Update `packages/frontend/src/components/livechat/MessageTypeCard.tsx` to read from the new `blocks` + `classifiedMessages` format, show intentOpenCode, confidence dots, agent role tags, and the LabelEditDropdown. (This is a significant rewrite — the component now receives a `ConversationBlock` + the conversation's `classifiedMessages` array + `messages` array to hydrate the bubbles.)

- [ ] **Step 5: Verify frontend compiles**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds (or fix type errors)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/livechat/
git commit -m "feat(frontend): add template selector, label edit dropdown, new accordion format"
```

---

### Task 8: Frontend — Message Type Feed with Standalone Versions

**Files:**
- Modify: `packages/frontend/src/components/livechat/MessageTypeFeed.tsx`
- Create: `packages/frontend/src/components/livechat/FeedItemExpanded.tsx`
- Modify: `packages/frontend/src/components/livechat/ConversationsTab.tsx` (By Message Type view)

- [ ] **Step 1: Create FeedItemExpanded component**

Create `packages/frontend/src/components/livechat/FeedItemExpanded.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ChatBubble } from "./ChatBubble";

export function FeedItemExpanded({
  conversationId,
  messageId,
  originalText,
  standaloneVersion,
  isFollowUp,
  precedingMessages,
  onClose,
}: {
  conversationId: Id<"livechatConversations">;
  messageId: number;
  originalText: string;
  standaloneVersion?: string;
  isFollowUp: boolean;
  precedingMessages: Array<{ id: number; role: string; text: string }>;
  onClose: () => void;
}) {
  const [editText, setEditText] = useState(standaloneVersion ?? originalText);
  const patchStandalone = useMutation(api.livechat.orchestration.patchStandaloneVersion);

  async function handleSave() {
    await patchStandalone({ conversationId, messageId, standaloneVersion: editText });
    onClose();
  }

  return (
    <div className="border-t border-border bg-bg-elevated p-3">
      {/* Preceding context */}
      <div className="text-[8px] uppercase tracking-wider text-text-dim mb-2">Preceding context</div>
      <div className="space-y-1 mb-3">
        {precedingMessages.map((msg) => (
          <div
            key={msg.id}
            className={`text-[11px] px-2 py-1 rounded ${
              msg.role === "user"
                ? "bg-accent-dim/30 text-accent-bright border border-accent/10"
                : "bg-bg-surface text-text-muted border border-border"
            }`}
          >
            <div className="text-[8px] text-text-dim mb-0.5">
              {msg.role === "user" ? "User" : "Agent"} · #{msg.id}
            </div>
            {msg.text}
          </div>
        ))}
      </div>

      {/* Original message */}
      <div className="border-t border-dashed border-border pt-2 mb-2">
        <div className="text-[8px] uppercase tracking-wider text-text-dim mb-1">Original message</div>
        <div className="text-[11px] text-accent-bright bg-accent-dim/20 border border-accent/10 rounded px-2 py-1">
          {originalText}
        </div>
      </div>

      {/* Edit standalone (only for follow-ups) */}
      {isFollowUp && (
        <div className="border-t border-border pt-2 mt-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[8px] uppercase tracking-wider text-accent">Standalone version (editable)</span>
            <span className="text-[7px] text-accent uppercase">AI-generated</span>
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full bg-bg-surface border border-border rounded px-2 py-1.5 text-xs text-accent-bright font-inherit resize-y min-h-[36px] outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button onClick={onClose} className="px-2 py-0.5 rounded text-[9px] border border-border text-text-dim hover:text-text">Cancel</button>
            <button onClick={handleSave} className="px-2 py-0.5 rounded text-[9px] bg-accent text-bg font-medium hover:opacity-90">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite MessageTypeFeed**

Rewrite `packages/frontend/src/components/livechat/MessageTypeFeed.tsx` to show standalone versions as primary text, with click-to-expand using FeedItemExpanded. Each feed item displays: visitor name, conversation ID, intentOpenCode, follow-up badge, confidence dot, the standalone/original question text, and the agent response.

- [ ] **Step 3: Update By Message Type data building in ConversationsTab**

Update the `messagesByType` useMemo in ConversationsTab to read from the new `blocks` + `classifiedMessages` fields, falling back to old `messageTypes` for backward compatibility.

- [ ] **Step 4: Verify frontend compiles and runs**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/livechat/
git commit -m "feat(frontend): rewrite Message Type feed with standalone versions and edit"
```

---

### Task 9: Build and Integration Test

**Files:**
- No new files — verification task

- [ ] **Step 1: Rebuild eval-lib**

Run: `cd /path/to/repo && pnpm build`
Expected: eval-lib builds successfully

- [ ] **Step 2: Run all eval-lib tests**

Run: `cd packages/eval-lib && pnpm test`
Expected: All tests pass (including existing transcript-parser tests)

- [ ] **Step 3: Deploy backend**

Run: `cd packages/backend && npx convex dev --once`
Expected: Deploys with new schema

- [ ] **Step 4: Build frontend**

Run: `cd packages/frontend && pnpm build`
Expected: Production build succeeds

- [ ] **Step 5: Manual smoke test**

1. Open the app, go to Knowledge Base → VF Qatar Support → Live Chat
2. Select a conversation, pick "CX Transcript Analysis" template, click Classify
3. Verify accordion cards show with intentOpenCode, confidence dots, agent role tags
4. Click a label badge → verify dropdown appears, select a different label → verify "edited" marker
5. Switch to "By Message Type" view → verify feed shows standalone versions for follow-ups
6. Click a follow-up item → verify context panel opens with original text and edit textarea

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: integration verification complete"
```
