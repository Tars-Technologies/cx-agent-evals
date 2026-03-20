# Codebase Concerns

**Analysis Date:** 2026-03-21

## Tech Debt

**LangSmith Integration Incomplete:**
- Issue: Two TODOs in experiments schema indicate missing LangSmith integration features
- Files: `packages/backend/convex/schema.ts:192-195`
- Current state: `langsmithExperimentId` and `langsmithUrl` fields exist but are never populated from `evaluate()` results
- Impact: Frontend cannot link experiments to LangSmith dashboards for viewing detailed traces and run history
- Fix approach: After `runLangSmithExperiment()` completes in `packages/backend/convex/experiments/actions.ts`, extract experiment ID and URL from LangSmith API response and update database record

**Abundant Type Casting (`as any`):**
- Issue: Widespread use of unsafe type assertions throughout backend code
- Files: `packages/backend/convex/langsmith/sync.ts:97`, `packages/backend/convex/experiments/actions.ts:227`, `packages/backend/convex/generation/actions.ts:21,29`, `packages/backend/convex/retrieval/chunks.ts:168,217`
- Impact: Masks type errors at compile time; runtime failures possible if data shape changes; reduces code safety and maintainability
- Fix approach: Replace `as any` casts with proper Zod validators or stricter type definitions. Define explicit types for query results instead of relying on `runQuery(...): Promise<any>`

**Polling Loop with Fixed Delays:**
- Issue: Synchronous polling in `packages/backend/convex/experiments/actions.ts:112-130` uses 2000ms sleep in a while loop
- Impact: Inefficient use of action execution time; could timeout on slow indexing; no exponential backoff
- Fix approach: Use Convex scheduled functions or webhook callbacks instead of polling. Alternatively, implement exponential backoff with configurable max wait time

## Security Considerations

**Org-Scoped Access Control Depends on JWT Claims:**
- Risk: All org-scoped access relies on `org_id` and `org_role` from Clerk JWT custom claims
- Files: `packages/backend/convex/lib/auth.ts:30-46`, all public queries/mutations that call `getAuthContext()`
- Current mitigation: JWT is validated by Convex auth middleware; org_id and org_role are custom claims set in Clerk JWT template
- Recommendations:
  - Add server-side audit logging for sensitive operations (KB deletion, experiment runs)
  - Validate org membership on sensitive mutations by cross-checking JWT org against database user records
  - Document the Clerk JWT template configuration (not found in repo)
  - Consider adding row-level security (RLS) patterns for additional safety

**LangSmith API Key Exposure:**
- Risk: `LANGSMITH_API_KEY` stored in Convex dashboard env vars; no rotation mechanism visible
- Files: All "use node" files import from `rag-evaluation-system/langsmith` which uses this key
- Current mitigation: Key only accessible in Convex "use node" actions; never exposed to frontend
- Recommendations:
  - Implement key rotation schedule (quarterly minimum)
  - Add monitoring for unauthorized LangSmith API usage
  - Consider using role-based API keys if LangSmith supports them

**OpenAI API Key in Multiple Environments:**
- Risk: `OPENAI_API_KEY` required in frontend `.env`, backend `.env`, and Convex dashboard
- Files: Multiple embedder and LLM imports across eval-lib, backend, frontend
- Impact: Higher surface area for key exposure; unclear whether frontend should have direct API access
- Recommendations:
  - Verify frontend actually needs OPENAI_API_KEY (check if it's only used server-side via Convex)
  - If frontend doesn't need it, move to backend-only env var
  - Consider wrapping OpenAI calls in backend API endpoints to centralize key access

## Known Issues

**Questionable Chunk Position Calculation in RecursiveCharacterChunker:**
- Symptoms: Character offset calculations in `chunkWithPositions()` may be inaccurate when text contains whitespace
- Files: `packages/eval-lib/src/chunkers/recursive-character.ts:53-88`
- Root cause: Trimming logic (lines 55-58) calculates offsets after trim but returns trimmed text, creating mismatch between returned text and position offsets
- Workaround: Currently mitigated by test coverage, but edge cases with multiple leading/trailing spaces could cause spans to miss intended text
- Improvement path: Refactor position tracking to maintain invariant: `doc.content[start:end] === chunk.content` exactly

**LangSmith Example ID Linking Non-Fatal But Silent:**
- Symptoms: Failed example ID linking in `packages/backend/convex/langsmith/sync.ts:92-119` is silently caught; caller won't know sync was incomplete
- Files: `packages/backend/convex/langsmith/sync.ts:116-119`
- Trigger: Network error or LangSmith API timeout during `client.listExamples()` call
- Workaround: Experiment runs work without example IDs, but result correlation may be lost
- Recommendation: Log failures to external observability tool; consider retrying with exponential backoff

## Test Coverage Gaps

**No E2E Tests for Full Experiment Pipeline:**
- What's not tested: Complete flow from dataset creation → generation → indexing → experiment run → result aggregation
- Files: Backend integration tests exist in `packages/backend/tests/` but are unit/function-level; no E2E tests cross package boundaries
- Risk: End-to-end failures (e.g., incorrect span matching or timing issues) could reach production undetected
- Priority: High - This is the core user-facing functionality
- Suggestion: Add convex-test E2E scenarios covering: KB upload → retriever indexing → dataset generation → experiment execution → result validation

**Frontend Error Handling Not Tested:**
- What's not tested: User-facing error messages, loading states, retry behavior in UI components
- Files: No test files found for `packages/frontend/src/components/*.tsx` or `packages/frontend/src/app/` pages
- Risk: Broken UI states, incorrect error messages, infinite loading spinners could degrade user experience unnoticed
- Priority: Medium - Frontend is presentation layer but critical for usability
- Suggestion: Add React Testing Library tests for major pages (IndexTab, GenerateConfig, ExperimentsPage) with mocked Convex queries

**Character Span Matching Not Exhaustively Tested:**
- What's not tested: Edge cases in span overlap calculations with real-world document variations (Unicode, formatting, empty sections)
- Files: `packages/eval-lib/src/utils/span.ts` has unit tests but limited edge case coverage
- Risk: Metrics (recall, precision, IoU) could be miscalculated on certain document types
- Priority: High - Core evaluation metric correctness
- Suggestion: Add property-based tests (property-testing library) for span calculations with random document/span generation

## Fragile Areas

**Document Chunking and Span Position Tracking:**
- Files: `packages/eval-lib/src/chunkers/recursive-character.ts` (155 lines of complex offset calculation logic)
- Why fragile: Recursive splitting with overlaps and trimming creates many edge cases; one offset error propagates to all downstream metrics
- Safe modification: Avoid changing separator logic without adding comprehensive edge-case tests; use invariant testing (`chunk_content === doc.content[start:end]`)
- Test coverage: Existing tests in `packages/eval-lib/tests/unit/chunkers/` but could be more exhaustive for Unicode and special characters

**WorkPool Job Coordination:**
- Files: `packages/backend/convex/retrieval/indexing.ts`, `packages/backend/convex/generation/orchestration.ts`, `packages/backend/convex/experiments/orchestration.ts`
- Why fragile: Multiple WorkPool instances (indexingPool, generationPool) with separate status tracking; cancellation logic is subtle (see comment at line 319 of `crud/retrievers.ts` about race condition avoidance)
- Safe modification: Never modify cancel/status update logic without understanding the full state machine; use detailed inline comments explaining why certain checks exist
- Test coverage: Backend tests have generation/indexing callback tests but limited cancellation scenario coverage

**LangSmith Dataset Sync:**
- Files: `packages/backend/convex/langsmith/sync.ts`, `packages/backend/convex/langsmith/syncRetry.ts`
- Why fragile: Manual example ID matching by query text (line 103) is brittle — query text collisions or LangSmith response changes break linking
- Safe modification: Add validation that matched examples actually correspond to intended questions (verify metadata); add logging for mismatch cases
- Test coverage: No mocked LangSmith API tests; relies on real LangSmith calls during backend test runs

## Performance Bottlenecks

**Unbounded `.collect()` in Database Queries:**
- Problem: Many queries use `.collect()` without pagination, loading entire result sets into memory
- Files: `packages/backend/convex/retrieval/chunks.ts:116,258,272`, `packages/backend/convex/generation/orchestration.ts:67,192,282,371,379`, and 20+ others
- Cause: Convex queries don't enforce limits; large KBs with 10k+ documents or chunks could exhaust action memory
- Improvement path:
  1. Add `limit` parameter to all queries that list multiple items
  2. Use pagination helpers (Convex's `.paginate()`) for frontend queries
  3. For backend batch operations, process in chunks (e.g., 100 items per WorkPool iteration)
- Estimated impact: Prevents scaling beyond ~5k documents per KB without memory issues

**Vector Search Post-Filtering Not Optimized:**
- Problem: `packages/backend/convex/lib/vectorSearch.ts` filters chunks client-side after vector search
- Impact: Retrieves topK from index, then applies additional filters, wasting embedding lookup bandwidth
- Improvement path: Push filtering into the vector search query using Convex's filtering syntax; or increase topK to account for filtered-out results

**LLM Calls Not Batched in Question Generation:**
- Problem: `packages/backend/convex/generation/actions.ts` generates questions per-document sequentially; each call waits for LLM response
- Impact: For large KBs, generation time = (num_docs × avg_llm_latency); no parallelism
- Improvement path: Batch documents into groups, use LLM batch API (if available), or increase WorkPool parallelism during generation phase

## Scaling Limits

**Convex Function Execution Timeout:**
- Current capacity: 10-minute timeout per Convex function execution
- Limit: Large indexing/generation jobs could timeout if they exceed 10 minutes
- Evidence: `packages/backend/convex/scraping/actions.ts` explicitly uses 9-minute budget to avoid timeout
- Scaling path:
  1. For indexing: reduce chunk batch size or increase WorkPool parallelism
  2. For generation: reduce questions per document or use multiple smaller jobs
  3. For experiments: implement streaming results instead of wait-for-completion

**WorkPool Parallelism Limited by Tier:**
- Current capacity: 3 (free), 10 (pro), 20 (enterprise) max parallel actions
- Limit: KB with 10k documents on free tier would take hours to index (10k ÷ 3 parallel ≈ 3k iterations × 2-5s per doc)
- Scaling path: Tier-based pricing is intentional; suggest users upgrade tier for large KBs; add UI warning for large uploads

**Vector Search Dimensionality:**
- Current capacity: Using `text-embedding-3-small` with 1536 dimensions
- Limit: Convex vector search performance degrades with very high dimensionality; current default is reasonable but switching to larger models would slow retrieval
- Scaling path: Benchmark performance with larger embedding models (3072 dims for -large) before offering as option

## Dependencies at Risk

**LangSmith v0.5.0 (Relatively New):**
- Risk: Used for experiment tracking; major API changes could break sync and evaluation flow
- Impact: If LangSmith introduces breaking changes, experiment runs would fail
- Migration plan: Pin to specific version; maintain compatibility layer in `rag-evaluation-system/langsmith` sub-path for easy upstream migration

**Turndown v7.2.2 (HTML to Markdown Conversion):**
- Risk: Used in scraped content processing; HTML parsing edge cases could produce malformed markdown
- Impact: Malformed markdown could break chunking or LLM processing
- Migration plan: Add HTML sanitization step before turndown; validate output markdown format

**Convex v1.32.0 (Breaking Changes Between Versions):**
- Risk: Tight coupling to Convex schema generation and WorkPool API
- Impact: Major Convex version upgrades could require significant refactoring
- Migration plan: Test major version upgrades in staging environment before production

## Missing Critical Features

**No Monitoring or Alerting for Failed Jobs:**
- Problem: Indexing/generation/experiment jobs can fail silently; no way to detect or alert on failures
- Blocks: Users can't easily tell why their knowledge bases aren't indexed or experiments failed
- Recommendation: Add Sentry or similar error tracking; emit alerts for failed WorkPool jobs; add job status dashboard

**No Experiment Result Export/Download:**
- Problem: Experiment results only viewable in UI; no API to export detailed results for analysis
- Blocks: Users can't do offline analysis or integrate results into external tools
- Recommendation: Add CSV export endpoint; expose results via public API endpoint

**No Rate Limiting on API Calls:**
- Problem: Queries/mutations have no built-in rate limiting
- Blocks: Malicious actors could DOS the system; users could accidentally spam queries
- Recommendation: Implement per-org rate limits in `packages/backend/convex/lib/auth.ts` using Convex rate limiting or simple counter pattern

**No Audit Log for Data Operations:**
- Problem: No record of who created/modified/deleted KBs, datasets, or experiments
- Blocks: Can't investigate data integrity issues or security incidents
- Recommendation: Add audit log table; log all CRUD operations with user ID, timestamp, and changes

---

*Concerns audit: 2026-03-21*
