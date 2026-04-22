# Case Design System (CDS)

> The design system for **Tars** — a Conversational AI company building
> solutions for the Customer Experience (CX) space.

CDS is the visual + content foundation for Tars' internal platform,
starting with **CX Agent Evals** — the framework engineers use to build,
test, and evaluate conversational CX agents before they reach customers.

This repository captures everything an agent (or a new designer) needs
to produce on-brand Tars surfaces: tokens, type, iconography, copy voice,
UI kit components, and rationale.

---

## Source material

| Resource | Where it lives |
|---|---|
| Primary codebase | `github.com/Tars-Technologies/cx-agent-evals` (branch `main`) |
| Live tokens | `packages/frontend/src/app/globals.css` |
| Root layout / font wiring | `packages/frontend/src/app/layout.tsx` |
| Mode / nav entrypoint | `packages/frontend/src/components/ModeSelector.tsx`, `Header.tsx` |
| Core interaction surfaces | `packages/frontend/src/components/AgentPlayground.tsx`, `AgentSidebar.tsx`, `ToolCallChip.tsx`, `ChunkCard.tsx` |

Only excerpts relevant to design are pulled in — nothing server/Convex-side.

No Figma file was provided. The design was reverse-engineered from source.

---

## Products represented

Only one product is currently covered by this system: **CX Agent Evals**,
an internal web tool.

- **CX Agent Evals (web app)** — A dark, mono-typeset dashboard for
  building knowledge bases, generating synthetic eval questions, running
  retrievers, configuring CX agents, and comparing experiment results.
  Five top-level modes: Knowledge Base · Dataset · Retrievers · Agents ·
  Experiments. Built on Next.js + Convex + Clerk + Tailwind v4.

If and when Tars extends CDS to the marketing site, docs, or the
customer-facing chatbot runtime, additional UI kits should be added under
`ui_kits/` following the same structure.

---

## Index of this folder

```
README.md                 — this file (overview, voice, visual rules)
SKILL.md                  — agent-invocable entry point
colors_and_type.css       — all design tokens (single source of truth)
fonts/                    — webfont notes (JetBrains Mono via Google Fonts)
assets/                   — logos, icons, brand imagery (placeholders noted)
preview/                  — rendered cards that populate the Design tab
ui_kits/
  cx-agent-evals/         — the main product UI kit
    index.html            — interactive recreation of core screens
    components/*.jsx      — factored-out components
    README.md             — kit-level notes
```

---

## Content fundamentals

Tars' current in-product copy is terse, technical, and matter-of-fact.
It is written *for engineers*, not for end users — this is an internal
tool, so the voice reflects that.

### Voice traits

- **Direct, imperative, no marketing fluff.** "Create and manage
  knowledge bases. Upload documents, import from URLs, and organize
  your data." No adjectives like "beautiful," "powerful," "seamless."
- **Title Case for product nouns and page titles.** "Knowledge Base,"
  "Run Experiments," "CX Agent Evals," "New Agent."
- **Sentence case for body copy and buttons.** "Type a message…",
  "Waiting for response to complete…", "Clear chat."
- **Second person, implicit subject.** The user is addressed as "you"
  only when necessary; most copy drops the subject ("Upload docs,"
  "Add tools," "Run & analyze").
- **Arrow-separated workflow trails.** Every card on the mode selector
  ends with a 3-step `Create KB → Upload docs → Import URLs` trail
  using Unicode arrows (`→`, or `&rarr;` in source). This is a
  signature pattern — use it for any multi-step affordance.
- **Diagnostic tone in errors.** Error text names the missing env var
  and where to fix it: "Check that ANTHROPIC_API_KEY (or
  OPENAI_API_KEY for OpenAI models) is set in Convex dashboard
  environment variables." Never just "Something went wrong."
- **No emoji.** Zero emoji in product copy. Unicode glyphs are used
  instead where a symbol is needed: `⚡` (tool call lightning), `→`
  (workflow step), `▸ ▾` (disclosure triangles), `·` (separator),
  `—` em dash for terse captions.
- **No exclamation marks.** Tone is calm and flat.
- **Abbreviate freely.** "KB" = Knowledge Base, "CX" = Customer
  Experience, "RAG" = Retrieval-Augmented Generation. No glossaries;
  the audience is technical.

### Micro-copy examples (lifted from source)

| Surface | Copy |
|---|---|
| App subtitle | "Build and Evaluate CX AI Agents" |
| KB card body | "Create and manage knowledge bases. Upload documents, import from URLs, and organize your data." |
| Dataset trail | `Generate questions → Edit & curate → Ground truth spans` |
| Empty-state | "No agents yet. Create one to get started." |
| Playground empty | "Send a message to start testing your agent." |
| Streaming tooltip | "Waiting for response to complete…" |
| Destructive confirm | `Type "delete" to confirm` |
| Meta tag | "0 retrievers · ready" |

### Do / don't

- ✅ "Create agent → Add tools → Test & iterate"
- ❌ "Unleash the power of your next agent!"
- ✅ "Send a message to start testing your agent."
- ❌ "Let's get chatting! 🚀"
- ✅ "No agents yet. Create one to get started."
- ❌ "Oops, nothing here yet. Click below to add your first agent 😊"

---

## Visual foundations

### Color

A **single dark theme.** There is no light mode, and adding one would
require new tokens — do not guess. The surface ladder is four steps:
`bg (#0c0c0f) → bg-elevated (#141419) → bg-surface (#1a1a22) →
bg-hover (#22222d)`. Cards sit on `bg-elevated`; inputs and code
blocks sit on `bg-surface`; row hover promotes to `bg-hover`.

Text is a three-step ladder: `text → text-muted → text-dim`. Never
use pure white or pure grey values outside these tokens.

The accent is a single hue — **Terminal Mint `#6ee7b7`**, used at
full intensity for the live-dot, primary buttons, focused tab
underlines, and inline code. A 10–20% alpha wash of mint is used for
user message bubbles (`bg-accent/10 border-accent/20`) and active
tab pills. `accent-bright (#a7f3d0)` is used for inline code glyphs
and selection foreground.

Semantic colors are amber (`#fbbf24`) for pending/warn and red
(`#f87171`) for error/destructive. Both used sparingly.

The **chunk rainbow** (`chunk-1..5` at 50% alpha) is reserved for
one purpose only: highlighting the five span classes in the RAG
retrieval UI. Do not reuse these hues elsewhere.

### Typography

**JetBrains Mono, everywhere.** Body, headings, buttons, labels, and
display type are all mono. The display token is also JetBrains Mono
— there is no serif or sans fallback in the system. This is the
central identity choice: a "terminal" aesthetic for a developer tool.

Base size is 13px with 1.6 line-height. The scale descends to 8–9px
for micro-tags and status pills (agent retriever count, status chips),
which is unusually small but consistent across the app. If you go
below 10px, match the pattern — do not invent intermediate sizes.

Weights used: 400 (body), 500 (buttons, active nav), 600 (headings,
labels). Italic is used only in blockquotes.

### Spacing & layout

- 4-px base grid. 12–24 px gutters between dense elements.
- Sidebars are a fixed 220 px.
- Max content width is 7xl (≈ 1280 px) with 24-px horizontal padding.
- Page chrome is a 56-px sticky top bar with a 1-px `border` divider
  and a backdrop-blur on semi-transparent elevated bg.
- Cards never touch each other — always separated by `space-6`.

### Borders, corners, shadows

- **Hairlines everywhere.** 1 px solid `--cds-border` is the default
  divider for headers, cards, inputs. `--cds-border-bright` for focus
  / hover.
- Corners: `4px` for chips and small pills, `6px` for buttons and
  inputs, `8px` for cards and panels, `12px` for chat bubbles,
  `9999px` for status dots and tab pills. Never mix radii within a
  single element.
- **Flat aesthetic, almost no shadows.** Elevation comes from border +
  background shift, not drop-shadow. Modals use a subtle
  `bg-black/50` scrim. The only glow is the span-highlight
  animation (`0 0 8px 3px rgba(110,231,183,.5)`) which flashes
  briefly when you click a citation.

### Backgrounds & imagery

- No full-bleed imagery. No gradients on surfaces (except the
  collapsed-chunk fade-to-bg overlay at the bottom of a ChunkCard).
- No textures, no patterns, no hand-drawn illustrations.
- Backgrounds are always solid tokens from the surface ladder.
- If brand imagery is needed, it should be photographic, cool-toned,
  and high-contrast — to match the palette. (None exists yet; flag
  if you need one.)

### Motion

- **Fast, short, mostly opacity/transform.** Three signatures:
  `fade-in` (300ms ease-out, 6-px translate-y), `slide-in` (250ms,
  −8px translate-x), `pulse-dot` (1.4s infinite opacity 0.4↔1).
- No bounces, no springs, no parallax.
- Hover transitions are 150 ms on `color`, `border-color`, `opacity`.
- The live-dot is the heartbeat of the brand — any "active" state
  should use the same pulse.

### Interaction states

- **Hover:** border brightens to `accent/50`, or background lifts by
  one surface step (`bg-surface/50`). Icons inside lift from
  `accent/10` → `accent/20` background wash.
- **Press / active:** no explicit pressed state — covered by the
  hover shift.
- **Focus:** input border changes to `accent/50`; no ring by default.
- **Disabled:** `opacity-50`, cursor not-allowed. Sometimes
  `bg-border text-text-dim cursor-not-allowed` for buttons.
- **Destructive:** `text-red-400` on hover, `bg-red-500` fill on
  confirm.

### Transparency & blur

- Sticky header uses `bg-bg-elevated/80` + `backdrop-blur-sm`. One of
  the only places blur appears.
- Message bubbles from the user use `bg-accent/10
  border-accent/20`. This is the canonical "owned by me" affordance.
- Status chips use `{color}/10` for background and `{color}` for text
  (e.g. `bg-accent/10 text-accent`, `bg-red-500/10 text-red-400`).

### Card anatomy

- Flat: border + background, no shadow.
- `border border-border rounded-lg bg-bg-elevated p-8` for landing
  cards. Smaller `rounded-md` for list rows.
- Landing card hover: `hover:border-accent/50
  hover:bg-bg-elevated/80` + nested icon wash lift, 200ms duration.
- Sidebar list items use a 3-px `accent` left border when selected,
  transparent when not. This is the one "colored left border" pattern
  the system *does* endorse — use it for list selection only, never
  for info cards.

---

## Iconography

**Primary system: Heroicons (outline, 24 px, 2 px stroke).** These
are inline SVGs copy-pasted into components — there is no icon font,
no sprite, and no npm dependency. The full set is available at
[heroicons.com](https://heroicons.com) under the MIT license. When
you need an icon that isn't already in the codebase, pull the outline
variant at 24 px and inline it the same way. In this kit we link the
CDN build of Lucide (an API-compatible outline-stroke set) for
convenience — the two are visually interchangeable at 24 px.

**Icon usage rules:**
- Default container: 40 × 40 rounded-lg, `bg-accent/10`, centered,
  with the icon at `w-5 h-5 text-accent` inside. Lifts to
  `bg-accent/20` on hover.
- Inline icons are `w-3 h-3` to `w-5 h-5`, always `currentColor`.
- Stroke-width 2 is the default; 1.5 for larger "chat bubble" style
  decorative icons.
- **No emoji.** Ever.
- **Unicode-as-icon** is permitted for well-known glyphs: `⚡`
  (tool call / agent action), `→` (step), `▸ ▾` (disclosure),
  `·` (separator), `—` (em dash).
- No PNG icons, no raster icons, no colored icons.

Placeholders are flagged where a real Tars brand asset is missing
(logo wordmark, product lockup, favicon).

---

## Known substitutions (please replace)

- **Wordmark / logo:** no Tars mark was found in the repo. The "live
  dot + wordmark" lockup in this kit uses the `#6ee7b7` pulse-dot +
  `CX Agent Evals` typeset in JetBrains Mono. Replace with the real
  Tars mark when available.
- **Font files:** JetBrains Mono is pulled from Google Fonts by
  CDN. No `.woff2` is shipped here. If Tars self-hosts, drop files
  into `fonts/` and update `colors_and_type.css`.
- **Brand imagery:** none exists. Nothing ships in `assets/imagery/`.

---

## Feedback on the current palette

You asked for honest feedback on the color system. Summary: **the
palette is cohesive and does more right than wrong, but two choices
are worth revisiting.**

**What is working:**
1. The four-step surface ladder (`bg → elevated → surface → hover`)
   is well-tuned and gives you clear hierarchy without shadows.
2. The three-step text ladder matches that hierarchy. Contrast ratios
   are 15:1 / 6.2:1 / 3.1:1 — the last is borderline for small text
   but fine for meta.
3. A single accent hue keeps the UI calm. Mint is a distinctive
   choice that reads as "agent / AI" without resorting to the default
   indigo-purple gradient every AI tool uses.

**What to reconsider:**

1. **Mint-as-sole-accent is fragile.** `#6ee7b7` is a cold, pastel
   green that's hard to pair with warm status colors (your amber +
   red feel slightly unrelated). And at full saturation on
   `bg-accent text-bg`, the contrast is 11:1 but the *vibrance*
   reads more "macOS terminal" than "Tars brand." Consider
   introducing a **deeper primary** (e.g. `#10b981` or `#059669`)
   for high-stakes actions and reserving mint for accents, live
   states, and highlights. This gives you a two-step accent
   ladder matching the surface + text ladders.

2. **The chunk rainbow is underused and out of system.** Five
   un-tokenized hues at fixed 50% alpha appear only in the RAG span
   UI. They work, but they feel like a separate palette bolted on.
   Options: (a) derive all five from the brand accent by rotating
   hue in OKLCH while holding chroma + lightness constant — gives
   you a "family" feel; (b) keep the rainbow but formalize it as
   `--data-viz-1..5` and document its one-and-only use-case.

3. **Semi-random Tailwind colors in components.** `red-400`,
   `red-500`, `yellow-400` appear inline in AgentSidebar's
   status chips — they bypass the token system. Formalize these
   as `--cds-status-error-fg / bg` and `--cds-status-warn-fg / bg`
   so the palette has one home.

4. **No "success" that isn't accent.** Mint doubles as both
   "primary action" and "ready / healthy / success." That
   collides semantically — a "ready" agent chip and a "Send"
   button both pulse the same green. A dedicated success hue
   (slightly bluer green) would disambiguate.

5. **Consider warming up `bg` by 1–2°.** `#0c0c0f` is nearly
   neutral-cool; shifting to `#0d0c0f` or `#0e0d10` (a hair of
   magenta) gives the UI a subtle warmth that pairs better with
   mint. This is a taste call, not a correctness one.

A proposed token refresh draft lives as comments in
`colors_and_type.css` — happy to produce a full alternate theme on
request.

---

*Last updated when this repo was generated. See `SKILL.md` for how an
agent should use this kit.*
