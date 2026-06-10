---
"@tars-inc/eval-lib": minor
---

Add configurable scraper and parser providers, plus SSRF hardening for the in-process scraper.

New `makeScraper` / `makeParser` factories select a backend behind unified `Scraper` / `Parser` interfaces:

- `inprocess` (default): single-page scraping and HTML/PDF/text parsing in your process
- `tarser`: a remote content service that submits jobs and returns results via signed callbacks

```ts
import { makeScraper, makeParser } from "@tars-inc/eval-lib/scraper"

const scraper = makeScraper() // in-process (default)
const remote = makeScraper({
  backend: "tarser",
  baseUrl: "https://content.example.com",
  apiToken: "<service token>",
  hmacSecret: "<callback secret>"
})
```

The in-process scraper is hardened against SSRF: only `http`/`https` to public hosts are allowed (loopback, private, link-local, and metadata addresses are rejected), each redirect hop is re-validated, and responses are capped by content type and size. Remote provider requests use a 30-second default timeout and report clear errors for empty or non-JSON successful responses. Adds `assertPublicHttpUrl` / `isBlockedHost` and callback signing helpers (`computeCallbackSignature` / `verifyCallbackSignature`).
