# Testing Patterns

**Analysis Date:** 2026-03-21

## Test Framework

**Runner:**
- Vitest 1.6
- Config: `packages/eval-lib/vitest.config.ts` and `packages/backend/vitest.config.ts`
- Globals enabled: `globals: true` (no need to import describe/it/expect)

**Assertion Library:**
- Vitest built-in assertions (same as Jest)
- Common matchers: `expect().toEqual()`, `expect().toHaveLength()`, `expect().toBe()`, `expect().toThrow()`

**Assertion Library (Backend):**
- Convex test utilities: `convexTest()` from `convex-test`
- WorkPool test utilities: `workpoolTest.register()` for pools

**Run Commands:**
```bash
# eval-lib
pnpm -C packages/eval-lib test              # Run all tests
pnpm -C packages/eval-lib test:watch        # Watch mode
pnpm -C packages/eval-lib test:coverage     # Coverage report

# backend
pnpm -C packages/backend test               # Run all tests via vitest

# from root
pnpm test                                   # Delegates to eval-lib
```

## Test File Organization

**Location:**
- eval-lib: `packages/eval-lib/tests/` — co-located by domain
- backend: `packages/backend/tests/` — separate from convex/ source
- Frontend: No tests currently

**Naming:**
- Test files: `*.test.ts` (not `.spec.ts`)
- Domain structure mirrors source: `tests/unit/synthetic-datagen/strategies/simple.test.ts` matches `src/synthetic-datagen/strategies/simple/generator.ts`

**Structure:**
```
packages/eval-lib/tests/
├── unit/                          # Unit tests
│   ├── synthetic-datagen/         # Strategy tests
│   │   ├── strategies/
│   │   │   ├── simple.test.ts
│   │   │   ├── dimension-driven-integration.test.ts
│   │   │   └── real-world-grounded-matching.test.ts
│   │   └── ground-truth/
│   │       └── assigners.test.ts
│   ├── scraper/
│   │   ├── seed-companies.test.ts
│   │   └── link-extractor.test.ts
│   └── ...

packages/backend/tests/
├── helpers.ts                     # Shared test utilities
├── generation.test.ts             # Domain tests
├── experiments.test.ts
├── indexing.test.ts
├── retrievers.test.ts
└── ...
```

## Test Structure

**Suite Organization:**
Standard Vitest describe/it pattern:

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("SimpleStrategy", () => {
  it("should generate queries for each document", async () => {
    // test body
  });

  it("should handle multiple documents", async () => {
    // test body
  });
});
```

**Example: eval-lib (from `packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts`):**
```typescript
describe("SimpleStrategy", () => {
  it("should generate queries for each document", async () => {
    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({
          questions: ["What does RAG combine?", "How does RAG work?"],
        });
      },
    };

    const strategy = new SimpleStrategy({ queriesPerDoc: 2 });
    const results = await strategy.generate({
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(2);
    expect(results[0].query).toBe("What does RAG combine?");
    expect(results[0].targetDocId).toBe("test.md");
    expect(results[0].metadata.strategy).toBe("simple");
  });
});
```

**Example: backend (from `packages/backend/tests/generation.test.ts`):**
```typescript
describe("generation: onQuestionGenerated", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("increments processedItems on success", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
      totalItems: 3,
      processedItems: 1,
    });

    await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
      workId: "w_fake",
      context: { jobId, itemKey: "doc_2" },
      result: { kind: "success", returnValue: {} },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.processedItems).toBe(2);
    expect(job!.failedItems).toBe(0);
    expect(job!.status).toBe("running");
  });
});
```

**Patterns:**
- Setup: Create test data (corpus, llm client, seeders)
- Act: Execute function being tested
- Assert: Verify results with expect()
- Backend tests use `beforeEach(() => { t = setupTest(); })` for fresh test context

## Mocking

**Framework:**
- eval-lib: Manual mock objects (no mocking library needed)
- backend: Convex test harness provides database/scheduler mocks

**Patterns:**

**eval-lib Mock LLM:**
```typescript
const llm: LLMClient = {
  name: "MockLLM",
  async complete() {
    return JSON.stringify({
      questions: ["Question 1", "Question 2"],
    });
  },
};
```

**Factory for Mocks:**
```typescript
function makeLLM(response: string): LLMClient {
  return {
    name: "MockLLM",
    async complete() {
      return response;
    },
  };
}

// Usage
const llm = makeLLM(JSON.stringify({ excerpts: [...] }));
```

**Backend Mocks (Convex Test):**
- Database is in-memory during tests
- `t.run()` executes code with test context
- `t.mutation()` / `t.query()` / `t.action()` call functions directly
- WorkPool callbacks tested via `t.mutation(internal.path.onComplete, ...)`

**What to Mock:**
- External APIs (LLM calls) — always mock in unit tests
- Database queries — use test harness (convex-test), don't mock
- HTTP calls — use retry pattern with error fallback
- File system — use test data in memory or fixtures

**What NOT to Mock:**
- Convex database operations (use convex-test harness)
- Core business logic (test actual implementations)
- Type constructors/factories

## Fixtures and Factories

**Test Data:**
eval-lib uses inline document creation:
```typescript
const doc = createDocument({
  id: "test.md",
  content: "RAG combines retrieval with generation.",
});
const corpus = createCorpus([doc]);
```

**Seeder Functions (Backend):**
Located in `packages/backend/tests/helpers.ts`:

```typescript
export async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      clerkId: TEST_CLERK_ID,
      email: "test@test.com",
      name: "Test User",
      createdAt: Date.now(),
    });
  });
}

export async function seedKB(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("knowledgeBases", {
      orgId: TEST_ORG_ID,
      name: "Test KB",
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

export async function seedDataset(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Dataset",
      strategy: "simple",
      strategyConfig: {},
      questionCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}
```

**Constants:**
```typescript
export const TEST_ORG_ID = "org_test123";
export const TEST_CLERK_ID = "user_test456";

export const testIdentity = {
  subject: TEST_CLERK_ID,
  issuer: "https://test.clerk.com",
  org_id: TEST_ORG_ID,
  org_role: "org:admin",
};
```

**Location:**
- Seeders: `packages/backend/tests/helpers.ts`
- Test data files: Not used (all inline or generated)

## Coverage

**Requirements:** Not enforced (no minimum coverage threshold)

**View Coverage:**
```bash
pnpm -C packages/eval-lib test:coverage
# Generates coverage report in packages/eval-lib/coverage/
```

**Config:** `packages/eval-lib/vitest.config.ts`
- Provider: v8
- Include: `src/**/*.ts`
- Exclude: `src/index.ts` and all `src/**/index.ts` (barrel files)

**Current Status:** 225 vitest tests in eval-lib, 46 integration tests in backend (total 271 tests)

## Test Types

**Unit Tests:**
- Scope: Individual strategies, ground truth assigners, metrics, utilities
- Approach: Inline mock objects + test data factories
- No external dependencies (no real API calls)
- Tests in `packages/eval-lib/tests/unit/`

Examples:
- `simple.test.ts` — Strategy generates correct output
- `assigners.test.ts` — Ground truth extraction handles missing/invalid spans
- `relevance-sampling.test.ts` — Sampling correctly stratifies documents

**Integration Tests (Backend):**
- Scope: Convex mutations, queries, actions, callbacks, WorkPool behavior
- Approach: convex-test harness with seeded database
- Tests database state transitions, scheduled actions, WorkPool callbacks
- Tests in `packages/backend/tests/`

Examples:
- `generation.test.ts` — Question generation job status tracking (increments processedItems, handles failures)
- `experiments.test.ts` — Experiment lifecycle (start, run, complete)
- `indexing.test.ts` — Document indexing callbacks and chunk storage
- `retrievers.test.ts` — Retriever CRUD, shared index protection, status sync
- `workpool-helpers.test.ts` — WorkPool state transitions

**E2E Tests:**
- Not present. Manual testing via development server.
- Could be added for critical user flows (auth, KB creation, generation, experiment run)

## Common Patterns

**Async Testing:**
Pattern: `async () => { await action(); expect(...); }`

```typescript
it("should generate queries for each document", async () => {
  const strategy = new SimpleStrategy({ queriesPerDoc: 2 });
  const results = await strategy.generate({
    corpus,
    llmClient: llm,
    model: "gpt-4o",
  });

  expect(results).toHaveLength(2);
});
```

**Error Testing:**
```typescript
it("should handle missing excerpts", async () => {
  const llm = makeLLM(
    JSON.stringify({
      excerpts: ["This text does not exist in the document at all"],
    }),
  );

  const assigner = new GroundTruthAssigner();
  const results = await assigner.assign(queries, {
    corpus,
    llmClient: llm,
    model: "gpt-4o",
  });

  expect(results).toHaveLength(0);
});
```

**Backend State Testing:**
Pattern: Seed initial state → mutate → assert final state

```typescript
it("increments failedItems and records details on failure", async () => {
  const userId = await seedUser(t);
  const kbId = await seedKB(t, userId);
  const datasetId = await seedDataset(t, userId, kbId);
  const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
    totalItems: 2,
  });

  await t.mutation(internal.generation.orchestration.onQuestionGenerated, {
    workId: "w_fake",
    context: { jobId, itemKey: "doc_1" },
    result: { kind: "failed", error: "LLM timeout" },
  });

  const job = await t.run(async (ctx) => ctx.db.get(jobId));
  expect(job!.failedItems).toBe(1);
  expect(job!.failedItemDetails).toEqual([
    { itemKey: "doc_1", error: "LLM timeout" },
  ]);
});
```

**Fixture Overrides:**
Domain-specific seeders accept partial overrides:

```typescript
async function seedGenerationJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  datasetId: Id<"datasets">,
  overrides: Partial<{
    status: string;
    phase: string;
    totalItems: number;
    processedItems: number;
    failedItems: number;
    skippedItems: number;
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("generationJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      datasetId,
      strategy: "simple",
      status: (overrides.status ?? "running") as any,
      // ... rest of fields with nullish coalescing
    });
  });
}

// Usage with overrides
const jobId = await seedGenerationJob(t, userId, kbId, datasetId, {
  totalItems: 3,
  processedItems: 1,
});
```

---

*Testing analysis: 2026-03-21*
