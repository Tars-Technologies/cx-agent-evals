# Coding Conventions

**Analysis Date:** 2026-03-21

## Naming Patterns

**Files:**
- Feature/component files use kebab-case: `simple-generator.ts`, `dimension-wizard.tsx`
- Domain modules use PascalCase for index files: `recursive-character.ts`
- Directory names use kebab-case: `synthetic-datagen/`, `vector-stores/`, `ground-truth/`
- Private/internal files follow same pattern as public

**Functions:**
- camelCase for all functions: `generate()`, `handleDiscover()`, `safeParseLLMResponse()`
- Async functions use same camelCase (no prefix): `handleDiscover()`, `complete()`
- React hooks follow React convention: `useCallback`, `useConvexAuth`, `useOrganization`
- Factory functions use descriptive names: `createDocument()`, `createCorpus()`, `DocumentId()` (branded type factory)

**Variables:**
- camelCase for all local variables and constants: `maxChars`, `docContent`, `validationErrors`
- Mutable state variables use camelCase: `const [step, setStep] = useState(...)`
- Private instance fields use underscore prefix: `private _options: SimpleStrategyOptions` (example: `src/synthetic-datagen/strategies/simple/generator.ts` line 49)
- Set/Map collections use descriptive plural names: `validationErrors: Set<number>`, `discoveredDimensions`

**Types:**
- Interface names use PascalCase with descriptive suffix: `SimpleStrategyOptions`, `AuthContext`, `GeneratedQuery`, `LLMClient`
- Type aliases use PascalCase: `DocumentId` (branded type), `CharacterSpan`
- Branded types created with factory functions: `export const DocumentId = (value: string): DocumentId => value as DocumentId;` (from `src/types/primitives.ts`)
- Generic type parameters use single capital letters or descriptive names: `<T>`, `<RunResult>`

## Code Style

**Formatting:**
- Tool: Prettier 3.2
- Print width: 100 characters
- Tab width: 2 spaces
- Semicolons: required (semi: true)
- Quotes: double quotes for strings (singleQuote: false)
- Trailing commas: all (trailingComma: "all")

**Linting:**
- Tool: ESLint with TypeScript plugin
- Config file: `eslint.config.mjs` at repo root
- Key rules enforced:
  - `@typescript-eslint/no-explicit-any`: warn
  - `@typescript-eslint/no-unused-vars`: error, with pattern ignoring underscore-prefixed params: `{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" }`
  - TypeScript strict mode enabled in all tsconfig files
- Run: `pnpm lint` from root, `lint:fix` for auto-fixes

**TypeScript Strict Mode:**
- All packages use strict: true
- noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch enabled
- Module resolution: bundler for build targets, node for runtime
- ESNext module format for library (eval-lib uses "type": "module")

## Import Organization

**Order:**
1. Type imports first: `import type { Type1, Type2 } from "..."`
2. Value imports second: `import { function1, Class1 } from "..."`
3. Side-effect imports last (if any)

**Pattern from source files:**
```typescript
// From src/synthetic-datagen/strategies/simple/generator.ts
import type {
  QuestionStrategy,
  StrategyContext,
  GeneratedQuery,
  SimpleStrategyOptions,
} from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";
```

**Path Aliases:**
- All relative imports use `./` prefix: `"./generator.js"` (explicit relative)
- ESM pattern: `.js` extension included in all relative imports (even though TypeScript)
- Frontend uses `@/` alias for `src/`: `import { Dimension } from "@/lib/types"`
- No barrel imports except at package boundaries (see structure for exceptions)

**Sub-path Exports (eval-lib):**
- `rag-evaluation-system/langsmith` - LangSmith integration (Node.js only, imported in `"use node"` actions)
- `rag-evaluation-system/llm` - LLM clients (OpenAI), Node.js only
- `rag-evaluation-system/shared` - Safe for all files (JobStatus, ExperimentResult, constants)
- `rag-evaluation-system/utils` - Utilities (hashing, span utilities)

## Error Handling

**Patterns:**
- Errors with descriptive messages for domain validation: `throw new Error("chunkOverlap must be less than chunkSize")`
- Auth errors: `throw new Error("Unauthenticated: no valid session")`
- Org-scoped access errors: `throw new Error("No active organization selected. Please select an organization to continue.")`
- Missing resource errors: `throw new Error("User not found. Please sign in again.")`

**Try-Catch Usage:**
- Used for dependency loading with clear error messages (example: `src/rerankers/cohere.ts`):
  ```typescript
  try {
    const CohereClient = (await import("cohere-ai")).default;
  } catch {
    throw new Error("cohere-ai package required. Install with: pnpm add cohere-ai");
  }
  ```
- Used for JSON parsing with fallback: `safeParseLLMResponse(response, fallback)` returns fallback if parsing fails
- Frontend error handling: UI sets error state and displays to user (example: `src/components/DimensionWizard.tsx` lines 46-49)

**UI Error Display:**
- Set error state: `setError(data.error || "Discovery failed")`
- Display with descriptive messages: "Connection failed — check server"
- Clear errors before retries: `setError(null)`

## Logging

**Framework:** console (Node.js console API)

**Patterns:**
- `console.warn()` for deprecations or suspect behavior: `console.warn(\`Document "${String(doc.id)}" truncated from ${doc.content.length} to ${maxChars} chars\`)`
- `console.warn()` with context for parsing failures: `console.warn("Failed to parse LLM response:", response.slice(0, 200))`
- No debug logging in production code (tests may use it)
- Backend (Convex) logs available via dashboard

## Comments

**When to Comment:**
- JSDoc for public API functions (required for exported functions)
- Inline comments for non-obvious algorithm logic
- Comments explaining "why" not "what" (code should be self-documenting)

**JSDoc/TSDoc:**
- Used extensively for function exports, especially in strategies and utilities
- Format: standard TSDoc (/** ... */)
- Include @param for each parameter, @returns for return value
- Example from `src/utils/fetch-json.ts`:
  ```typescript
  /**
   * Fetch and parse JSON with retry for transient failures.
   * - Wraps the network call in {@link withRetry} for transient-failure resilience.
   */
  export function fetchJson<T>(options: ...): Promise<T>
  ```

## Function Design

**Size:** Keep functions focused to a single responsibility. Large functions (>50 lines) are broken into helpers.

**Parameters:**
- Use object destructuring for multiple params: `async generate(context: StrategyContext): Promise<GeneratedQuery[]>`
- Optional params within single object: `readonly retry?: { maxRetries?: number; backoffMs?: number };`
- No positional boolean parameters; use options objects

**Return Values:**
- Explicit return types always (TypeScript strict mode)
- Async functions return `Promise<T>` explicitly
- Array results use `readonly T[]` when immutability applies
- Nullable results use `T | undefined` (not `T | null`)

**Immutability:**
- Document and Corpus types use `readonly` (see `src/types/documents.ts`)
- Object.freeze() used for config and metadata objects
- Spread operator for updates rather than mutations: `{ ...d, ...updates }`

## Module Design

**Exports:**
- Explicit named exports, no default exports (except in barrel index files)
- Separate type exports from value exports: `export type { TypeA }` then `export { FunctionA }`
- Private functions not exported (no export prefix)

**Barrel Files (index.ts):**
- Used at package boundaries to control public API
- Example: `src/index.ts` re-exports from all subdomains
- Frontend: `src/lib/convex.ts` re-exports Convex API
- Backend: None (file-based routing via Convex)

**File Organization:**
- One class per file: `SimpleStrategy` in `simple/generator.ts`
- Related types in same file as implementation or in sibling `types.ts`
- Utilities co-located with domain: `src/utils/json.ts` for JSON parsing

## Convex-Specific Patterns

**Query/Mutation Signatures (Backend):**
- Always call `getAuthContext(ctx)` at handler top (see `src/crud/knowledgeBases.ts` line 18)
- Always define args with Convex validators: `args: { name: v.string(), optional: v.optional(...) }`
- Handler signature: `handler: async (ctx, args) => { ... }`

**"use node" Constraint:**
- Files with `"use node"` can ONLY contain actions, no mutations/queries
- Domain example: `convex/experiments/actions.ts` has `"use node"`, `convex/experiments/orchestration.ts` does not
- Action imports: can use Node.js-only packages (openai, langsmith, @langchain/core)

**WorkPool Pattern (Backend):**
- Status tracked with transitions: "pending" → "running" → "complete"/"failed"
- Per-item callbacks in separate `onComplete` mutations
- Example: `internal.generation.orchestration.onQuestionGenerated` callback

## React/Frontend Patterns

**Component Naming:**
- PascalCase for component files: `DimensionWizard.tsx`, `AuthGate.tsx`
- Descriptive names: `RetrieverPlayground`, `QuestionList`

**Hooks Usage:**
- React hooks at top of components: `useState`, `useCallback`
- Convex hooks: `useQuery`, `useMutation` (reactive)
- Clerk hooks: `useAuth`, `useOrganization`

**Event Handlers:**
- Prefix with "handle": `handleDiscover()`, `handleSkip()`, `validateAndAdvance()`
- Callbacks wrapped in `useCallback` for optimization

---

*Convention analysis: 2026-03-21*
