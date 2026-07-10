---
"@tars-inc/eval-lib": patch
---

`QdrantVectorStore` now refuses HTTP redirects (`redirect: "error"`): fetch does not strip the `api-key` header on cross-origin redirects, so following one could leak it. Qdrant itself never redirects; a setup behind a redirecting proxy now fails fast with a descriptive error instead of leaking. Other providers are unchanged.
