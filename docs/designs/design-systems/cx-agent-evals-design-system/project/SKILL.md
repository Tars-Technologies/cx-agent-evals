---
name: tars-design
description: Use this skill to generate well-branded interfaces and assets for Tars (Conversational AI / CX platform), either for production or throwaway prototypes, mocks, decks, etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping the CX Agent Evals product and related surfaces.
user-invocable: true
---

Read the `README.md` file within this skill first, and explore the other
available files:

- `colors_and_type.css` — drop-in design tokens (CSS variables)
- `preview/` — reference cards demonstrating every visual foundation
- `ui_kits/cx-agent-evals/` — component source for the core product
- `fonts/` — font notes (JetBrains Mono, via Google Fonts CDN)
- `assets/` — brand logos and imagery (may contain placeholders —
  check the README for what's real and what needs replacement)

If you are creating visual artifacts (slides, mocks, throwaway
prototypes, etc), copy the relevant assets out and build static HTML
files for the user to view. Link `colors_and_type.css` or paste its
tokens inline. Prefer the components in `ui_kits/cx-agent-evals/` as
starting points rather than rebuilding from screenshots.

If you are working on production code, you can copy assets and read
the rules in the README to become an expert in designing with the
Tars brand — especially the content-voice, iconography, and
motion sections, which are easy to get wrong from tokens alone.

If the user invokes this skill without any other guidance, ask them
what they want to build or design, ask a few focused questions about
audience / fidelity / variations, and then act as an expert designer
who outputs HTML artifacts or production code depending on the need.

### Hard-coded rules to respect

- JetBrains Mono is the entire type system. No sans, no serif.
- Dark theme only. Do not invent a light mode without tokens.
- Terminal Mint (`#6ee7b7`) is the only accent. No gradients on surfaces.
- No emoji in product copy. Unicode glyphs (`⚡ → ▸ ▾ · —`) are fine.
- Copy is imperative and flat. No "seamless / powerful / beautiful".
- Workflow trails are 3 arrow-separated steps. Use them.
- Icons are Heroicons outline, 24px, 2px stroke. Inline SVG only.
- Cards are flat: 1px border + bg-elevated. Shadows are rare.
- Selected list items get a 3px accent left border. Nothing else.
- The live-dot pulse (1.4s) is the brand heartbeat — use it for any
  "active / live / healthy" state.
