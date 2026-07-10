---
"@tars-inc/eval-lib": patch
---

Security hardening: `QdrantVectorStore` now refuses to follow HTTP redirects (`redirect: "error"`) so the `api-key` header — which fetch does not strip on cross-origin redirects — can never leak to a redirect target. Qdrant's REST API never redirects, so no working setup is affected. Other providers' HTTP behavior is unchanged.
