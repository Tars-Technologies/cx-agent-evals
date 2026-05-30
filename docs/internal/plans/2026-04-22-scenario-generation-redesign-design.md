# Scenario Generation Redesign — Design Document

**Date:** 2026-04-22
**Status:** Approved

## Problem

The current scenario generation system is minimal: a single modal with count + complexity sliders, generating scenarios purely from KB documents via LLM. It lacks grounding in real conversation data, user control over dimensions, and configurability. The question generation system has a richer 4-step wizard, but scenario generation hasn't caught up.

## Objective

Redesign scenario generation from the ground up to produce realistic, grounded conversation scenarios for simulation testing. Primary input: existing live chat transcripts (already parsed and classified in the livechat analysis system). Secondary input: KB documents for coverage gap filling.

## Design Decisions

### Hybrid approach
- **Transcript-grounded scenarios** (default heavy): derive scenarios directly from real conversations
- **Synthetic scenarios**: generated from transcript patterns + KB content to fill coverage gaps
- Configurable distribution slider (default 80% grounded / 20% synthetic)

### Transcript source
- Uses existing `livechatConversations` data (stored via the livechat analysis system) — no re-upload or re-processing
- Transcripts are org-scoped and already parsed/classified
- Selection: pick conversation transcript sets, filter by classification/quality/labels, manual include/exclude individual conversations
- User-facing terminology: "Conversation Transcripts" (not "uploads")

### Classification usage
- **Filter only** — classification data (message types, labels) used to select which transcripts to include
- Raw transcript messages go to the scenario generator; the LLM figures out structure
- Quality filters: has user response, has agent response, etc.

### Fidelity
- Configurable slider: Faithful (high) to Varied (low)
- Default: maximum fidelity (scenarios closely mirror source transcripts)
- Lower fidelity = more creative variation from the same transcript patterns

### Transcripts are optional
- If no transcripts selected, distribution auto-locks to 100% synthetic
- Wizard adapts gracefully — step 1 can be skipped
- Replaces the old `ScenarioGenerationWizard` entirely

## Architecture: Two-Phase Pipeline

### Phase 1: Transcript Analysis
Single LLM call analyzes the filtered transcript pool as a corpus. Produces a "transcript profile":
- Persona clusters (types of users appearing in transcripts)
- Common intents and topics
- Conversation patterns and complexity distribution
- Language usage

### Phase 2: Scenario Generation (two parallel tracks)

**Grounded track** — for each selected transcript (sampled to match grounded count):
- LLM extracts persona, intent, topic, complexity from the transcript
- Selects real user messages as `referenceMessages`
- Generates `instruction` field for the user simulator
- Sets `sourceType: "transcript_grounded"` and `sourceTranscriptId`
- Batched: 5 transcripts per LLM call

**Synthetic track** — uses transcript profile + KB content:
- Generates novel scenarios covering gaps not represented in transcripts
- Sets `sourceType: "synthetic"`
- Batched: 5 per LLM call (same as current system)

### Execution
- Both tracks run sequentially within a single Convex action (stays within action limits)
- If user selects more transcripts than grounded count, sample diversely: pick transcripts that maximize coverage across the transcript profile's persona clusters, topics, and intents (round-robin across clusters, not random)
- If user selects fewer transcripts than grounded count, generate multiple scenarios per transcript (e.g., 10 transcripts → 20 grounded means ~2 scenarios per transcript with fidelity-controlled variation)
- If no transcripts, Phase 1 skipped, only synthetic track runs
- Progress updates after each batch across both tracks, with phase indicator ("analyzing transcripts", "generating grounded scenarios", "generating synthetic scenarios")

### Error Handling
- If Phase 1 (transcript analysis) fails, fall back to synthetic-only generation (treat as distribution=0)
- If a grounded batch fails (JSON parse error, etc.), skip that batch and continue; log error but don't fail the whole job
- If a synthetic batch fails, same — skip and continue
- Final `generatedCount` reflects actual successful scenarios, which may be less than `targetCount`
- Job status is "completed" if at least 1 scenario generated, "failed" only if zero scenarios produced

### Cancellation
- Same pattern as current system: store `workIds` on the job record for selective cancellation
- Cancellation stops further batches but scenarios already saved remain in the dataset

### Action Timeout
- Convex actions have a 10-minute timeout. Estimated budget: ~30s for transcript analysis, ~15s per batch of 5 (LLM call + saves). A 50-scenario run with 40 grounded + 10 synthetic = 8 grounded batches + 2 synthetic batches = ~180s total. Well within limits.
- For safety, if generation approaches 8 minutes elapsed, stop batching and save what we have

## Schema Changes

### `conversationScenarios` table — new fields
```typescript
sourceType: "transcript_grounded" | "synthetic"
sourceTranscriptId?: Id<"livechatConversations">  // only for grounded
languages: string[]                                 // e.g., ["english", "arabic"]
```

Existing fields unchanged: `persona`, `topic`, `intent`, `complexity`, `reasonForContact`, `knownInfo`, `unknownInfo`, `instruction`, `referenceMessages`.

### `scenarioGenJobs` table — new flat fields
Existing fields (`orgId`, `kbId`, `datasetId`, `status`, `targetCount`, `generatedCount`, `error`, `createdAt`, `completedAt`) remain unchanged. Add:
```typescript
// New flat fields on the job record (all optional for backward compat)
transcriptUploadIds?: Id<"livechatUploads">[]
transcriptConversationIds?: Id<"livechatConversations">[]
distribution?: number        // 0-100, % transcript-grounded
fidelity?: number            // 0-100, high = faithful
```
Note: `count`, `model`, and `complexityDistribution` are passed as action args (not stored on the job record), matching the existing pattern. The new fields are stored on the job for UI display/traceability.

## Wizard UX (4-step)

### Step 1: Select Transcripts (skippable)
- Picker showing available conversation transcript sets (from livechat analysis, org-scoped)
- Multi-select transcript sets — selecting multiple merges all their conversations into one list below
- Filters: classification type + specific classes, quality (has responses, etc.), labels
- Conversation table with checkboxes, IDs, visitor names, classification tags as colored pills, message count
- Select all / deselect all
- "Skip — generate without transcripts" link
- If no transcript sets exist in the org, show a message: "No conversation transcripts available. You can upload transcripts in the Knowledge Base section, or skip to generate synthetic scenarios."

### Step 2: Configure Generation
- Total scenario count slider (5–50)
- Source distribution slider: Transcript-grounded ↔ Synthetic (default 80% grounded)
  - Shows calculated split: "24 grounded, 6 synthetic"
  - Disabled if step 1 skipped (locked to 100% synthetic)
- Fidelity slider: Varied ↔ Faithful (default max faithful)
  - Disabled if step 1 skipped
- Complexity distribution: low/medium/high triple slider with stacked bar (existing pattern)

### Step 3: Preferences & KB
- KB selector — pre-filled with the current page's KB (passed as prop `kbId`), but user can change it via dropdown. Used for synthetic track input.
- Model selector (default: `claude-sonnet-4-20250514`)
- Placeholder for future preferences (tone, focus areas, topic weighting)
- Validation: if no transcripts selected (step 1 skipped) AND no KB selected, show inline warning: "Select a knowledge base to generate synthetic scenarios, or go back and select transcripts." Generate button disabled until at least one source is provided.

### Step 4: Review & Generate
- Summary cards (3x2 grid): Source, Split, Fidelity, Complexity, KB, Model
- Each card has "Edit" link to jump back to that step
- Dataset name input
- "Generate N Scenarios" button

### EditScenarioModal updates
- Display `sourceType` as a read-only chip (grounded/synthetic) in the header
- Display `languages` as read-only chips
- Display `sourceTranscriptId` as a read-only mono-text link (if grounded)
- These fields are not editable — they're provenance metadata

### Component reuse
- Stepper bar pattern from `GenerationWizard.tsx`
- Slider styling from `TotalQuestionsSlider.tsx` and `ScenarioGenerationWizard.tsx`
- Conversation list/checkbox pattern from `ConversationList.tsx`
- Tag pills from `ScenarioList.tsx` chip pattern
- Summary cards from `WizardStepReview.tsx`
- All theme tokens from `globals.css`

## Mockup
Visual mockup available at `.superpowers/brainstorm/` in the project directory (wizard-v2.html).
