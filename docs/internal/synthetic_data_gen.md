# Synthetic Data Generation — Strategy Design Document

## Context

The quality of RAG evaluation is only as good as the synthetic questions used during evaluation. If the synthetic questions don't reflect the diversity, complexity, and intent distribution of real user queries, the evaluation results will be misleading — you'll optimize for a distribution that doesn't match production. This document explores multiple strategies for generating high-quality synthetic questions for both **chunk-level** and **token-level** evaluation.

For chunk-level evaluation, the generator receives pre-chunked text with chunk IDs and must produce questions tied to specific chunk IDs. For token-level evaluation, the generator receives full documents and must produce questions tied to character spans (exact excerpts).

---

## Strategy 1: Direct Prompt-Based Generation

### Overview

The simplest approach. Provide the LLM with the context (chunks with IDs for chunk-level, or full documents for token-level) and ask it to generate synthetic user questions along with the ground truth labels.

### How It Works

**Chunk-Level:**
```
System: You are generating evaluation questions for a RAG system.
Given the following document chunks (each labelled with an ID), generate
{N} diverse questions that can be answered using one or more of these chunks.
For each question, list the chunk IDs that contain the answer.

User:
[chunk_a3f2b1c8d9e0]: "Kubernetes pods are the smallest deployable units..."
[chunk_7d9e4f2a1b3c]: "A Service in Kubernetes is an abstraction..."
[chunk_b2c8d9e0f1a3]: "ConfigMaps allow you to decouple configuration..."

Output JSON: { "qa_pairs": [{ "query": "...", "relevant_chunk_ids": ["chunk_..."] }] }
```

**Token-Level:**
Two-step process:
1. Generate questions from the full document.
2. For each question, extract verbatim excerpts from the document, then locate their character positions.

### The Prompt Engineering Challenge

The core challenge here is crafting prompts that produce questions with the right properties:

**What makes a good synthetic question:**
- Answerable from the provided context (not hallucinated)
- Requires actual retrieval (not trivially answerable from a document title)
- Varied in structure: factoid, comparison, procedural, conditional, multi-hop
- Natural-sounding — resembles what a real user would type or say
- Not copy-pasted or trivially rephrased from the source text

**Prompt refinement approach:**
1. **Start with a baseline prompt** — straightforward instruction to generate questions.
2. **Generate a batch of ~50 questions** and manually review them for quality.
3. **Identify failure modes**: Are they too simple? Too uniform? Too tied to document phrasing? Do they test recall of information or just keyword matching?
4. **Add constraints iteratively**: "Do not use the same phrasing as the source text." "Include at least one multi-hop question that requires information from multiple chunks." "Vary the question format — include yes/no, open-ended, and comparison questions."
5. **Use few-shot examples in the prompt**: Provide 2-3 examples of high-quality questions paired with their ground truth, so the LLM understands the expected output format and quality bar.
6. **Test across different document types**: A prompt that works well for API documentation may produce poor results for legal contracts or product FAQs.

**Key prompt parameters to tune:**
- Temperature (0.7-0.9 for diversity, lower for precision)
- Number of questions per document/chunk window
- Whether to include negative examples ("Do NOT generate questions like...")
- Whether to ask for difficulty labels alongside the question

### Strengths
- Simple to implement and iterate on
- No external data dependencies
- Works out of the box for any domain

### Weaknesses
- Questions tend to cluster around the most prominent information in each chunk/document
- Limited diversity — the LLM has no model of what real users actually ask
- Hard to control the distribution of question types, complexity levels, or user intents
- Prompt sensitivity: small wording changes can significantly shift output quality

---

## Strategy 2: Dimension-Driven Generation

### Overview

Before generating questions, explicitly identify the **dimensions of variation** that matter for the specific use case, then systematically vary them during generation. This produces a more structured and diverse evaluation set.

### Step 1: Identify Dimensions

The dimensions depend heavily on the actual application. For a customer support chatbot for a SaaS product, relevant dimensions might be:

| Dimension | Example Values |
|-----------|---------------|
| **User Persona** | New user, power user, admin, developer, non-technical manager |
| **Query Intent** | Troubleshooting, how-to, conceptual understanding, comparison, pricing |
| **Query Complexity** | Single-fact lookup, multi-step reasoning, cross-document synthesis |
| **Specificity Level** | Broad ("How does auth work?"), narrow ("What's the rate limit for /api/v2/users?") |
| **Tone / Formality** | Casual ("how do I fix this"), formal ("Please advise on the recommended procedure for...") |
| **Geographic / Locale** | Region-specific regulations, currency, language patterns |
| **Temporal Context** | Current version, migration from v1 to v2, deprecated features |
| **Emotional State** | Frustrated (broken feature), exploratory (evaluating the product), urgent (production outage) |

### Step 2: Automatic Dimension Discovery

Manually defining dimensions is tedious and risks blind spots. A more scalable approach: **use the company's public-facing materials to bootstrap dimension discovery**.

**Website analysis approach:**
1. Crawl or fetch the company's website (marketing pages, docs, support pages, pricing page).
2. Feed the content to an LLM with a prompt like:

```
Given the following content from [Company]'s website, identify the key dimensions
that would vary across real user questions asked to their AI assistant.

For each dimension, provide:
- Dimension name
- Why it matters for question diversity
- 5-10 concrete values

Consider: user roles, product areas, question intents, complexity levels,
and any domain-specific axes of variation.
```

3. The LLM identifies dimensions grounded in the actual product/domain rather than generic categories.
4. A human reviews and adjusts the dimensions — removing irrelevant ones, adding missed ones.

**Why this works:** The website reveals the product's feature areas, target personas, common workflows, pricing tiers, and integration points. These map directly to the axes along which user questions vary.

### Step 3: Combinatorial Generation

Once dimensions and their values are identified, generate questions by sampling combinations:

```
System: You are generating a synthetic user question for a RAG evaluation.
Generate a question that matches the following profile:

- Persona: {power_user}
- Intent: {troubleshooting}
- Complexity: {multi-step}
- Product Area: {authentication}
- Tone: {frustrated}

The question should be answerable from the following context:
{document or chunks}

Output the question and identify the relevant {chunk_ids | text excerpts}.
```

Not every combination is valid — some can be pruned (e.g., a "new user" persona asking about advanced admin configuration is unlikely). The generation can use stratified sampling across dimensions to ensure coverage without combinatorial explosion.

### Strengths
- Systematic coverage of the question space
- Diversity is a structural guarantee, not a prompt-engineering hope
- Dimensions are inspectable and adjustable
- Can weight dimensions to match expected production distribution

### Weaknesses
- Requires upfront work to identify meaningful dimensions
- Some combinations produce unnatural questions
- Still relies on LLM quality for the actual question text
- Dimensions may drift as the product evolves

---

## Strategy 3: Real-World Question-Grounded Generation

### Overview

The most grounded approach: use actual user questions from production (live chat, chatbot logs, support tickets) as the foundation for synthetic data generation. Real questions provide the most accurate signal about what users actually ask — their vocabulary, intent distribution, complexity level, and pain points.

### Modes of Use

**Mode A — Direct reuse:** Use real user questions as-is in the evaluation set. The challenge is assigning ground truth (which chunks/spans answer each question).

**Mode B — Few-shot seeding:** Use real questions as few-shot examples when generating new synthetic questions on specific documents or chunks. The LLM sees the style and distribution of real questions and mimics them.

**Mode C — Hybrid:** Use a mix of real questions (for high-fidelity coverage of known patterns) and synthetically generated questions (for coverage of edge cases and new content not yet queried by users).

### The Matching Problem

The key challenge: given a set of real-world questions and a set of documents/chunks, how do you determine which real questions are relevant to which documents/chunks?

**Embedding-based matching approach:**

1. Embed all documents (or chunks) using the same embedder used in the RAG pipeline.
2. Embed all real-world questions.
3. Compute cosine similarity between each question and each document/chunk.
4. For each document/chunk, select the top-K most similar real questions.

These matched questions serve as few-shot examples or as direct evaluation queries.

**The document-level dilution problem for token-level evaluation:**

When embedding an entire document for token-level evaluation, long documents produce embeddings that are an average of all their content. A question about a specific paragraph may not rank high against the full-document embedding because the paragraph's signal is diluted by thousands of other characters.

**Recommended solution — passage-level matching even for token-level evaluation:**

1. Split each document into passages using a simple sentence-based or paragraph-based splitter. This is purely for the matching step — it does not affect the token-level ground truth format (which still uses character spans on the full document).
2. Embed these passages.
3. Match real questions against passages.
4. When using the matched questions as few-shot examples for a document, aggregate: if a question matches any passage within that document, it's a candidate few-shot example for that document.

This avoids the dilution problem while keeping the token-level ground truth format intact. The passage splitter used here doesn't need to be the same as the chunker being evaluated — it's just a utility for the matching step.

**Alternative: BM25 or hybrid retrieval for matching:**

Embedding similarity sometimes misses lexical matches (specific error codes, product names, API endpoints). A hybrid approach using both BM25 (keyword matching) and embedding similarity can improve matching quality:

1. Score each (question, passage) pair with both BM25 and cosine similarity.
2. Combine scores (e.g., reciprocal rank fusion or weighted sum).
3. Take top-K matches.

### Workflow

```
Real Questions DB
       │
       ▼
  ┌──────────────┐     ┌──────────────┐
  │ Embed         │     │ Embed         │
  │ questions     │     │ doc passages  │
  └──────┬───────┘     └──────┬───────┘
         │                     │
         └────────┬────────────┘
                  ▼
         Cosine Similarity / BM25
         Match questions → passages
                  │
                  ▼
    ┌─────────────────────────────┐
    │ Per document/chunk:         │
    │ - Top-K matched real Qs     │
    │ - Use as few-shot examples  │
    │   OR use directly as eval   │
    │   queries                   │
    └─────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────┐
    │ Generate synthetic Qs       │
    │ (with real Qs as few-shot)  │
    │ + ground truth labels       │
    └─────────────────────────────┘
```

### Ground Truth Assignment for Direct Reuse (Mode A)

When using real questions directly, ground truth must be assigned:

**For chunk-level:** Retrieve top chunks using a high-quality retrieval setup, then have an LLM judge which chunks are genuinely relevant. This is a "labeling" step, not generation.

**For token-level:** Retrieve relevant passages, then have an LLM extract the exact verbatim excerpts that answer the question. Map excerpts to character spans in the source document.

### Strengths
- Highest fidelity to actual production query distribution
- Captures real vocabulary, abbreviations, typos, domain jargon
- Reveals actual user pain points and common workflows
- Few-shot examples steer synthetic generation toward realistic outputs

### Weaknesses
- Requires access to production query logs (may not exist for new products)
- Real questions may have privacy/PII concerns — need scrubbing
- Matching quality depends on embedder and passage splitting
- Real question distribution may have blind spots (features users don't know exist)

---

## Strategy 4: Adversarial and Edge-Case Generation

### Overview

Specifically target the failure modes of RAG systems by generating questions designed to be hard to retrieve correctly. While strategies 1-3 aim to reflect the typical query distribution, this strategy stress-tests the system.

### Question Types to Generate

**Near-miss questions:** Questions that are superficially similar to content in the corpus but actually ask about something not covered. Tests whether the system retrieves irrelevant-but-similar chunks (precision failures).

```
Prompt: Given this document about Kubernetes Services, generate a question that
SOUNDS like it's about Kubernetes Services but actually asks about something
NOT covered in the document. The RAG system should ideally return nothing
rather than return an irrelevant chunk.
```

**Cross-document reasoning:** Questions requiring synthesis of information from multiple documents. Tests whether the system can retrieve from multiple sources.

**Paraphrase-heavy questions:** Rephrase the source content heavily — use synonyms, different sentence structures, different levels of abstraction. Tests whether the embedder can handle semantic similarity beyond lexical overlap.

**Negation and conditional questions:** "What does X NOT support?" or "Under what conditions does X fail?" These are notoriously hard for embedding models.

**Ambiguous questions:** Questions with multiple valid interpretations where different chunks are relevant depending on interpretation. Tests whether the system handles ambiguity.

### Implementation

Use an LLM with a specialized prompt for each adversarial category. Include the document content and specify exactly what type of challenging question to generate.

### Strengths
- Reveals weaknesses that normal question distributions miss
- Directly improves system robustness
- Useful for regression testing after pipeline changes

### Weaknesses
- Adversarial questions may not reflect actual user behavior
- Can over-index on edge cases at the expense of common-case performance
- Harder to generate valid ground truth for (especially for near-miss questions where the answer is "nothing relevant")

---

## Strategy 5: Topic-Cluster and Information-Gap Analysis

### Overview

Analyze the corpus structure to identify distinct topics and information clusters, then generate questions that ensure every topic cluster has adequate coverage. Also identify "gaps" — topics that exist in the corpus but might be underrepresented in a naive question generation approach.

### How It Works

1. **Cluster the corpus:** Embed all chunks/passages, then cluster them (K-means, HDBSCAN, or LLM-based topic modeling). Each cluster represents a topic area.

2. **Label clusters:** Use an LLM to generate a human-readable label for each cluster based on its constituent chunks.

3. **Generate questions per cluster:** For each topic cluster, generate a target number of questions, ensuring even coverage across all topics.

4. **Identify sparse regions:** If certain clusters are small or isolated, explicitly generate more questions for them — these are the areas most likely to be missed by naive approaches.

5. **Cross-cluster questions:** Generate questions that span two or more topic clusters, testing the system's ability to retrieve from multiple topic areas.

```
Step 1: Embed all passages → Cluster into K topics
Step 2: For each cluster, generate N/K questions
Step 3: For sparse clusters, generate extra questions
Step 4: Generate M cross-cluster questions
```

### Strengths
- Guarantees coverage across the entire corpus, not just the most prominent topics
- Reveals content that exists but would never be queried by other strategies
- Cross-cluster questions test multi-document retrieval

### Weaknesses
- Clustering quality affects everything downstream
- May generate questions for obscure topics that no real user would ask about
- Requires an embedding step before question generation

---

## Strategy 6: User Journey and Multi-Turn Simulation

### Overview

Real users don't ask questions in isolation — they follow journeys. A user might start with a broad question ("What is feature X?"), then drill down ("How do I configure X for my use case?"), then troubleshoot ("Why is X returning error 403?"). Generating questions in these sequences produces more realistic and challenging evaluation sets.

### How It Works

1. **Define journey templates** based on common user workflows:
   - Onboarding: overview → setup → first use → troubleshooting
   - Feature exploration: what is → how to → advanced config → comparison with alternatives
   - Problem resolution: symptom → diagnosis → fix → prevention

2. **For each document or topic area**, simulate a user journey:

```
System: You are simulating a user interacting with a support chatbot.
The user is going through an onboarding journey for the following product area.

Given this document context, generate a sequence of 4-5 questions that a user
would naturally ask in order, where each question builds on the previous ones.

For each question, identify the relevant {chunk IDs | text excerpts}.
```

3. **Use the sequence:** Each question in the sequence becomes an independent evaluation query, but the sequence structure ensures diversity in depth and intent.

### Strengths
- Captures the progressive-depth pattern of real user behavior
- Naturally produces a mix of simple and complex questions
- Sequences cover broad-to-specific range within each topic

### Weaknesses
- The sequential dependency means one poor question can skew the rest of the sequence
- May over-represent common journeys at the expense of unusual query patterns
- More complex to implement than single-question generation

---

## Combining Strategies

No single strategy is sufficient. The recommended approach is to **layer strategies**, using each to cover different aspects of the question space:

| Strategy | % of Eval Set | Purpose |
|----------|--------------|---------|
| Strategy 1: Direct Prompt | 10% | Baseline coverage, simple to generate |
| Strategy 2: Dimension-Driven | 25% | Structured diversity across personas, intents, complexity |
| Strategy 3: Real-World Grounded | 30% | Fidelity to actual user behavior |
| Strategy 4: Adversarial | 15% | Stress-test and edge-case coverage |
| Strategy 5: Topic-Cluster | 10% | Corpus coverage guarantee |
| Strategy 6: User Journey | 10% | Sequential and progressive-depth coverage |

The exact mix depends on:
- **Product maturity:** New products have no real queries → lean on strategies 1, 2, 5. Mature products → lean on strategy 3.
- **Evaluation goal:** General quality assessment → balanced mix. Regression testing after pipeline change → lean on strategies 3, 4. Chunker comparison → lean on strategies 1, 2 (need controlled variation).
- **Corpus characteristics:** Narrow domain with few topics → less need for strategy 5. Broad corpus → strategy 5 is critical.

---

## Quality Assurance for Generated Questions

Regardless of strategy, validate the generated questions:

1. **Answerability check:** Use an LLM to verify each question is actually answerable from the assigned ground truth context. Discard or regenerate questions that aren't.

2. **Deduplication:** Embed all generated questions and flag near-duplicates (cosine similarity > 0.92). Keep the more diverse/harder one.

3. **Ground truth verification:** For token-level evaluation, verify that every assigned character span actually exists in the source document at the specified offsets. For chunk-level, verify all chunk IDs exist in the index.

4. **Human spot-check:** Sample 5-10% of the generated set and manually review for naturalness, correctness, and difficulty distribution.

---

## Implementation Considerations

### Interface Design

All strategies should implement a common interface so they can be composed:

```typescript
interface SyntheticQuestionStrategy {
  readonly name: string;
  generate(
    context: StrategyContext,
    options: GenerateOptions,
  ): Promise<GeneratedQuestion[]>;
}

interface StrategyContext {
  corpus: Corpus;
  evaluationType: EvaluationType;
  // Strategy-specific:
  chunks?: Map<ChunkId, Chunk>;              // for chunk-level
  realWorldQuestions?: RealWorldQuestion[];   // for strategy 3
  dimensions?: DimensionConfig[];            // for strategy 2
  topicClusters?: TopicCluster[];            // for strategy 5
}

interface GeneratedQuestion {
  query: string;
  groundTruth: ChunkLevelGroundTruth | TokenLevelGroundTruth;
  metadata: {
    strategy: string;
    dimensions?: Record<string, string>;     // which dimension values were used
    sourceRealQuestion?: string;             // if derived from a real question
    journeyPosition?: number;               // position in a journey sequence
    adversarialType?: string;               // type of adversarial question
  };
}
```

### Composing Strategies

```typescript
class CompositeQuestionGenerator {
  private strategies: Array<{
    strategy: SyntheticQuestionStrategy;
    weight: number;  // proportion of total questions
  }>;

  async generate(
    context: StrategyContext,
    totalQuestions: number,
  ): Promise<GeneratedQuestion[]> {
    const results: GeneratedQuestion[] = [];
    for (const { strategy, weight } of this.strategies) {
      const count = Math.round(totalQuestions * weight);
      const questions = await strategy.generate(context, { count });
      results.push(...questions);
    }
    return this.deduplicate(results);
  }
}
```

This design allows mixing strategies, adjusting weights, and adding new strategies without changing existing code.