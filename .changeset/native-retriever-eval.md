---
"@tars-inc/eval-lib": minor
---

- Add `runRetrieverEvaluation` — a framework-agnostic retriever evaluation harness that computes span metrics directly, with no LangSmith dependency.
- Fix ground-truth span assignment silently dropping questions whose excerpts differ from the source only by smart quotes / em-dashes; such excerpts now match, and genuinely unlocatable questions are logged instead of vanishing silently.
