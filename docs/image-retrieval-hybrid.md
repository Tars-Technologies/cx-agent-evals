# Image Retrieval: Reference vs. Hybrid

## Reference — "caption at ingest, text retrieval"

A vision LLM captions each image **once at ingest**; the caption is embedded like any
text chunk in the same vector store. Retrieval only ever sees caption text, never pixels.

```
Image ─▶ blob storage
   └─▶ vision LLM caption ─▶ text-embedding ─▶ vector store (metadata: imageStorageId)
```

- **Pro:** retrieval sees *inside* the image (chart values, labels); cost paid once.
- **Con:** captions every image (incl. logos); recall capped by a blind caption;
  stale on model change; no human override.

## Hybrid (recommended)

Keep the vision caption, but make it the **embedding input** and defer inclusion to the
agent. Everything degrades to context-only embedding if vision is off/fails.

**Embedding input, highest priority first:**
1. `manualContext` — human override, dominant
2. `visionCaption` — sees inside the pixels
3. alt / figure caption / heading
4. surrounding text — only if nothing above

**Cost control:**
- Caption only **non-decorative** images (skip icons/pins/logos).
- Cache: `captionHash = hash(model + url + grounding)` → unchanged ⇒ skip vision call.
- Per-KB toggle to turn captioning off for illustrative KBs.

**Query time (unchanged):** separate media table → doc-gated ranking → agent menu →
`get_images` pixel-inspection gate → marker whitelisting. Video/doc: no caption.

**Deferred:** image blob storage. For now caption fetches from the live URL and discards
bytes; later, read from storage instead (one line changes).

**Net:** vision-quality recall, paid once + cached, junk filtered, plus a human override
and an agent pixel gate the reference lacks.
