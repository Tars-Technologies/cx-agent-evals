# Sales Agent Playbook

A reusable guide for building and evaluating a sales-style AI agent for a
new customer using **cx-agent-evals**.

**Audience:** Tars engineers and future-Vinit.

**Status:** Work-in-progress. Phases are filled in as we run them against
real customers. The first worked example is **Vodafone Qatar (VFQ)
Telesales Agent**.

## How to use this playbook

The playbook is organized into six phases, each with the same structure:

- **Goal** — what the phase produces.
- **Inputs** — what must be in place before starting.
- **Decisions** — the high-leverage choices in this phase, each with
  options, how to choose, and signals of "this is working."
- **Customer callout** — what was decided for a specific customer, and why.
  VFQ is the running example. Swap callouts when reusing for a new customer.
- **Gaps & workarounds** — platform limits hit during this phase, tagged
  `blocker` / `workaround` / `wishlist`.

When applying this playbook to a new customer:

1. Read each phase's decisions before starting.
2. Make the decisions for your customer; replace the callout with your
   customer's choices and rationale.
3. If you hit a platform gap, classify it (see "Gap-handling protocol" in
   the design doc) and decide whether to detour, work around, or defer.

The design doc for this playbook lives at
`docs/superpowers/specs/2026-04-25-telesales-agent-playbook-design.md`.

---

## Phase 1: KB / Content

### Goal

A clean, in-scope **knowledge base** of documents that the retriever can
search and the agent can use to answer customer questions. Output: a
populated `knowledgeBases` record with associated `documents` in
cx-agent-evals, ready for chunking and indexing.

### Inputs

- **Source(s) of truth** for the customer's product information — usually
  the customer's website, but can also be PDFs, internal docs, FAQ exports,
  or transcripts.
- A clear understanding of **what the agent will and will not answer**.
  This bounds what content belongs in the KB and what should be a tool
  call or out-of-scope response.

### Decisions

#### 1. Source selection — what content goes into the KB

**Options:**

- **Public website crawl** — start URL on the customer's site, follow
  links. Default option for sales agents because product/plan info usually
  lives there.
- **Targeted page list** — curated list of URLs (e.g., one page per plan)
  imported one at a time. Use when the site has lots of noise and you want
  surgical coverage.
- **File upload** — PDFs, markdown, exported docs. Use for content not on
  the public web (internal pricing sheets, partner-only material).
- **Hybrid** — mix of the above.

**How to choose:**

- Start with what the agent will be asked. Map the top 5–10 question types
  to the content that answers them. The source that covers the most of
  those becomes the primary, others fill gaps.
- If the site is content-heavy and well-organized, prefer **crawl** with
  tight `includePaths` over a targeted page list — easier to refresh.
- If the site has heavy navigation/marketing fluff that pollutes the
  content, prefer **targeted page list** or post-crawl pruning.
- Avoid mixing very different content shapes in a single KB without
  thought (e.g., dense product specs + free-form blog posts). It hurts
  retrieval. Either filter at crawl time or use document `priority`/tags
  to bias retrieval later.

**Signals it's working:**

- For each top question type the agent must handle, you can point to a
  specific document (or set of documents) that contains the answer.
- Spot-checking 5–10 random documents shows clean, on-topic content.

#### 2. Crawl scope — depth, pages, include/exclude patterns

If using crawl (decision 1), tune these knobs in the Import URL modal /
`scraping.orchestration.startCrawl`:

| Knob | Default | When to change |
|---|---|---|
| `maxDepth` | 3 | Drop to 1–2 if the customer's site is shallow and the start URL already exposes most product pages. Raise to 4–5 only if key content is buried. |
| `maxPages` | 200 | Raise for large sites (300–800). Don't overshoot — every extra noisy page hurts retrieval and costs embedding credits. |
| `includePaths` | (none) | Use to scope to product/pricing/plan pages. Prefer permissive patterns first, then tighten after looking at the first crawl's pages. |
| `excludePaths` | (none) | Use to drop blogs, news, careers, login flows, support tickets, and anything not pre-sales relevant. |
| `allowSubdomains` | false | Enable only if key content lives on a subdomain (e.g., `business.example.com`). |
| `onlyMainContent` | true | Keep on. Strips nav/footer/sidebars. |
| `delay` / `concurrency` | 0 / 3 | Add a small `delay` (200–500ms) and lower concurrency for sites that rate-limit or for politeness on a single customer's domain. |

**How to choose:**

- Run a **dry pilot crawl** first: `maxPages: 30`, default depth, no
  include/exclude patterns. Look at what you got. Use that to design the
  real `includePaths` / `excludePaths`.
- The goal of a real crawl is **high signal-to-noise**, not maximum
  coverage. A 100-page focused crawl beats a 500-page noisy one.

**Signals it's working:**

- Pilot crawl pages look like the kind of pages a customer would land on
  pre-purchase.
- Less than ~10% of pages are "obviously off-topic" (blog posts,
  unrelated landing pages, legal boilerplate).

#### 3. Content cleaning

**Options:**

- **`onlyMainContent: true`** — built-in HTML→Markdown extraction with
  Readability. Removes nav/footer/sidebar. Default.
- **Post-crawl pruning** — manually delete documents that survived the
  crawl but are off-topic. Use the KB document list to remove obvious junk.
- **Document `priority`** (1–5, default 3) — bias retrieval toward
  high-value docs (e.g., main plan pages = 5, FAQ filler = 2). Cheaper than
  deleting; useful when borderline docs might still help in some queries.

**How to choose:**

- Start with `onlyMainContent: true` and good include/exclude patterns.
  Delete obvious junk after the crawl. Use `priority` only if you have a
  clear signal that some docs are more authoritative than others.
- Don't over-prune early. It's easier to deprioritize than to recrawl.

**Signals it's working:**

- Open 5 random documents. Each one reads like content, not a page
  template. Headings make sense. No "Cookie policy" / "Sign up for our
  newsletter" boilerplate dominates.

#### 4. Document organization — KB structure

**Options:**

- **Single KB per agent** — default and simplest. One agent, one KB,
  retriever indexes everything in it.
- **Multiple KBs per agent (federated)** — only if cx-agent-evals supports
  it cleanly *and* the customer has clearly disjoint content domains. Adds
  complexity; usually not worth it for a single agent's first version.

**How to choose:**

- Default to a single KB. Use document `priority`, tags, and
  `sourceType` metadata to express within-KB structure.

**Signals it's working:**

- The KB has a clear name and description that match the agent's purpose.
- Documents have meaningful titles (not just URLs).

#### 5. Quality bar — when is the KB "done enough" to move to phase 2

A KB is good enough to leave Phase 1 when:

- The top 5–10 question types the agent must answer each map to at least
  one document.
- Spot-checking ~10 random documents shows clean, on-topic markdown.
- Total document count is in a reasonable range for the customer's product
  surface — for a typical sales agent, **80–300 documents** is normal. Far
  less suggests under-crawling; far more suggests under-filtering.
- No glaring duplicates (same plan page captured 5 times under different
  URLs). If duplicates exist, tighten the crawl or delete them.

You don't need a *perfect* KB. The dataset and retriever phases will
surface gaps; you'll iterate. Time-box this phase.

### VFQ callout

> *To be filled during application.*

### Gaps & workarounds

> *To be filled during application.*

---

## Phase 2: Evaluation Dataset

> *Not yet drafted. Coming when we reach this phase.*

## Phase 3: Retriever

> *Not yet drafted. Coming when we reach this phase.*

## Phase 4: Agent Config

> *Not yet drafted. Coming when we reach this phase.*

## Phase 5: Agent Evaluation

> *Not yet drafted. Platform capability still being built; section will
> reflect what's available when we get here.*

## Phase 6: Ship & Monitor

> *Stub. Platform capability does not yet exist. Will be filled in once
> rollout / observability features are added.*

---

## Platform wishlist

> *Empty so far. Items go here when a platform gap is classified as
> `wishlist` during a phase.*
