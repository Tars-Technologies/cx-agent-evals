---
"@rag-eval/backend": minor
"frontend": minor
---

Agent responses can now retrieve and show real images/videos from the knowledge base instead of describing them from memory or hallucinating URLs.

- Images/videos extracted at ingest, embedded (Qdrant), ranked per query, and offered to the agent as a menu; a `get_images` tool lets it see pixels before deciding to include one.
- Responses go through a whitelist + corrective-retry pass so only real, retrieved media can render — fabricated URLs are stripped.
- Per-agent `enableMultimodal` toggle, manual per-image context override, and eval-side tracking (`shownImages`, `image_hygiene` checks, vision-capable judge) for scoring image usage.
- This review pass fixed a chunk-offset desync bug, unified drifted logic across the live/sim/experiment agent paths, added failure observability, and batched a KB-wide reprocess mutation that could exceed Convex's write limits on large KBs.
