"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "@/lib/convex"

/**
 * Modal editor for user-authored media context. The context a user types here is
 * the HIGHEST-priority signal for matching that media (it overrides the scraped
 * alt/caption/heading). Saving re-embeds the item.
 */
export function MediaContextEditor({
  kbId,
  onClose
}: {
  kbId: Id<"knowledgeBases">
  onClose: () => void
}) {
  const media = useQuery(api.kb.images.listMediaForKb, { kbId })
  const setContext = useMutation(api.kb.images.setMediaContext)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [docFilter, setDocFilter] = useState<string>("all")

  // Distinct documents that have media, for the filter dropdown.
  const docOptions = new Map<string, string>()
  for (const m of media ?? [])
    for (const d of m.docs) docOptions.set(d.id, d.title)

  const q = search.trim().toLowerCase()
  const filtered = (media ?? []).filter((m) => {
    const matchesSearch =
      q === "" ||
      `${m.alt} ${m.mediaType} ${m.manualContext ?? ""}`
        .toLowerCase()
        .includes(q)
    const matchesDoc =
      docFilter === "all" || m.docs.some((d) => d.id === docFilter)
    return matchesSearch && matchesDoc
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text">Media context</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text text-xs"
          >
            ✕
          </button>
        </div>
        <p className="text-[11px] text-text-dim mb-3">
          Add context to a media item to control how it&apos;s matched to
          questions. Your text leads the match as the{" "}
          <strong>highest-priority</strong> signal (blended with the scraped
          label/caption). Saving re-embeds the item.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search media by label, type, or context…"
            className="flex-1 text-xs bg-bg-surface border border-border rounded p-2 text-text"
          />
          <select
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value)}
            className="text-xs bg-bg-surface border border-border rounded p-2 text-text max-w-[45%]"
          >
            <option value="all">All documents</option>
            {[...docOptions.entries()].map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </div>

        {media === undefined && (
          <p className="text-xs text-text-dim">Loading…</p>
        )}
        {media && media.length === 0 && (
          <p className="text-xs text-text-dim">
            No media in this knowledge base yet.
          </p>
        )}
        {media && media.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-text-dim">No media matches “{search}”.</p>
        )}

        <div className="space-y-4">
          {filtered.map((m) => {
            const draft = drafts[m.imageId] ?? m.manualContext ?? ""
            return (
              <div
                key={m.imageId}
                className="border border-border rounded p-3"
              >
                <div className="flex gap-3">
                  {m.mediaType === "image" && m.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.url}
                      alt={m.alt}
                      className="w-20 h-20 object-cover rounded border border-border shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-text-dim">
                      {m.mediaType}
                    </div>
                    <div
                      className="text-xs text-text truncate"
                      title={m.alt}
                    >
                      {m.alt || "(no label)"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.docs.map((d) => (
                        <span
                          key={d.id}
                          className="text-[10px] text-text-dim bg-bg-surface border border-border rounded px-1 py-0.5 truncate max-w-[10rem]"
                          title={d.title}
                        >
                          {d.title}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [m.imageId]: e.target.value }))
                  }
                  placeholder="Add context (highest priority for matching)…"
                  className="mt-2 w-full text-xs bg-bg-surface border border-border rounded p-2 text-text resize-y min-h-[3rem]"
                />
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      await setContext({
                        kbId,
                        imageId: m.imageId,
                        manualContext: draft
                      })
                      setSavedId(m.imageId)
                      setTimeout(
                        () => setSavedId((s) => (s === m.imageId ? null : s)),
                        2500
                      )
                    }}
                    className="px-2 py-1 text-[11px] bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
                  >
                    Save &amp; re-embed
                  </button>
                  {savedId === m.imageId && (
                    <span className="text-[11px] text-accent">
                      Saved — re-embedding…
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
