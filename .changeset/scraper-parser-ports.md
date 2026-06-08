---
"@tars-inc/eval-lib": minor
---

Add configurable scraper and parser providers. A new factory (`makeScraper` / `makeParser`) selects an in-process backend (default) or a remote content service, behind unified `Scraper` and `Parser` interfaces. Includes HTML/PDF in-process parsing and helpers for verifying signed remote callbacks.
