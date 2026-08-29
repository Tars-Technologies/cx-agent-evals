# CX Agent Evals — UI Kit

A hi-fi, interactive recreation of the core screens in Tars' CX Agent
Evals tool. Source code lifted from `Tars-Technologies/cx-agent-evals`
(Next.js + Tailwind v4 + Clerk + Convex), pared down to static HTML +
React Babel + inline styles using CDS tokens.

## Components

- `Shell.jsx`         — app chrome (sticky header, live-dot lockup, nav pill, org block)
- `ModeSelector.jsx`  — 5-card landing grid (KB / Dataset / Retrievers / Agents / Experiments)
- `AgentsScreen.jsx`  — sidebar list + empty/playground right pane, full screen composition
- `Sidebar.jsx`       — agent list with selection, status chips, new-agent button
- `Playground.jsx`    — chat surface with streaming caret, tool-group pill, markdown prose
- `ToolGroup.jsx`     — expanding ⚡ group that wraps individual ToolChip's
- `KBScreen.jsx`      — knowledge-base view: left list + middle doc + right chunks
- `ExperimentsScreen.jsx` — run comparison table with metric cells
- `Bits.jsx`          — atoms: Dot, Icon, Chip, Button, Input, StatusPill

## index.html

Boots a tiny router (segmented tabs in the header) that swaps between
`ModeSelector → Agents → KB → Experiments`. Click a card on the
landing page, or use the top-nav pill. The Playground simulates a
fake agent conversation: type and press Enter, watch the tool chip
animate, then the streaming reply.

Nothing is real — no backend, no auth. All state lives in React.
