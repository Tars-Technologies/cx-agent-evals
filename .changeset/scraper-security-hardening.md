---
"@tars-inc/eval-lib": minor
---

Harden the in-process scraper against SSRF: only `http`/`https` to public hosts are allowed (loopback, private, link-local, and metadata addresses are rejected), each redirect hop is re-validated, and responses are capped by content type and size. Adds `assertPublicHttpUrl` / `isBlockedHost` helpers.
