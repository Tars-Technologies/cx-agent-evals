# RAG Eval Frontend

Next.js 16 app for visual question generation and result inspection. Dark theme, Tailwind CSS v4.

## Setup

```bash
# From repo root
sfw pnpm install
pnpm build          # Build the eval-lib first

# Add OpenAI API key
echo "OPENAI_API_KEY=sk-your-key" > packages/frontend/.env

# Start dev server
pnpm dev             # or: pnpm -C packages/frontend dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend start
```

## Usage

1. **Choose evaluation mode** — Chunk-level or Token-level
2. **Load a corpus** — Point to a folder containing markdown files
3. **Pick a strategy**:
   - **Simple** — Set questions-per-document and generate
   - **Dimension-Driven** — Auto-discover user dimensions from a URL (or define manually), review in the wizard, set a question budget, then generate
4. **Watch generation** — Phase progress shows pipeline stages, then questions stream in per document
5. **Inspect results** — Click any question to see the source document with highlighted relevant chunks or spans

Dimension configurations are saved to localStorage and persist across restarts.
