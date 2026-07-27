---
"@tars-inc/eval-lib": minor
---

Agent responses can now retrieve and show real images/videos from the knowledge base instead of describing them from memory or hallucinating URLs.

- Images/videos extracted at ingest, embedded (Qdrant), ranked per query, and offered to the agent as a menu; a `get_images` tool lets it see pixels before deciding to include one.
- Responses go through a whitelist + corrective-retry pass so only real, retrieved media can render — fabricated URLs are stripped.
- Per-agent `enableMultimodal` toggle, manual per-image context override, and eval-side tracking (`shownImages`, `image_hygiene` checks, vision-capable judge) for scoring image usage.
- This review pass fixed a chunk-offset desync bug, unified drifted logic across the live/sim/experiment agent paths, added failure observability, and batched a KB-wide reprocess mutation that could exceed Convex's write limits on large KBs.
- `IMAGE_RE` now supports the optional `"title"` form (`![alt](url "title")`). Previously a titled image failed to match at all, so it was neither recognized as media nor stripped from chunk text — leaking raw markdown into embeddings. `rewriteMarkdownImages` now preserves the title when rewriting.
- `htmlToMarkdown`'s `[embed:video]`/`[embed:doc]` token generation now escapes `"` in titles and encodes `)` in urls before interpolating them into the token. Previously a title containing a literal quote, or a url containing a literal `)` (e.g. a parenthesized filename), could prematurely close the token and leak stray page text into ingested document content.
- `@qdrant/js-client-rest` moved from `devDependencies` to `dependencies` — `qdrant-media.ts` imports its types in method signatures, so it was only resolving via workspace hoisting rather than an honest dependency declaration.
