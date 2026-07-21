---
"@tars-inc/eval-lib": patch
---

Fix markdown media parsing and content-safety issues found in code review:

- `IMAGE_RE` now supports the optional `"title"` form (`![alt](url "title")`). Previously a titled image failed to match at all, so it was neither recognized as media nor stripped from chunk text — leaking raw markdown into embeddings. `rewriteMarkdownImages` now preserves the title when rewriting.
- `htmlToMarkdown`'s `[embed:video]`/`[embed:doc]` token generation now escapes `"` in titles and encodes `)` in urls before interpolating them into the token. Previously a title containing a literal quote, or a url containing a literal `)` (e.g. a parenthesized filename), could prematurely close the token and leak stray page text into ingested document content.
- `@qdrant/js-client-rest` moved from `devDependencies` to `dependencies` — `qdrant-media.ts` imports its types in method signatures, so it was only resolving via workspace hoisting rather than an honest dependency declaration.
