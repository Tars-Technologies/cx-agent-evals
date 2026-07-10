---
"@tars-inc/eval-lib": patch
---

Type Qdrant wire bodies against the official `@qdrant/js-client-rest` OpenAPI schema. Type-only devDependency — the Qdrant client is never instantiated and the HTTP transport is unchanged; collection create bodies, filters, query requests, and response parsing are now schema-checked at compile time.
