"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useQuery } from "convex/react"
import { api } from "@/lib/convex"

interface KBDropdownProps {
  selectedKbId: Id<"knowledgeBases"> | null
  onSelect: (kbId: Id<"knowledgeBases">) => void
}

export function KBDropdown({ selectedKbId, onSelect }: KBDropdownProps) {
  const kbs = useQuery(api.kb.core.listWithDocCounts, {})

  if (kbs === undefined) {
    return (
      <div className="flex items-center gap-2 text-text-dim text-sm">
        <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        Loading...
      </div>
    )
  }

  return (
    <select
      value={selectedKbId ?? ""}
      onChange={(e) => {
        if (e.target.value) {
          onSelect(e.target.value as Id<"knowledgeBases">)
        }
      }}
      className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none truncate"
    >
      <option value="">Select a knowledge base...</option>
      {kbs.map((kb) => (
        <option key={kb._id} value={kb._id}>
          {kb.name} ({kb.documentCount}{" "}
          {kb.documentCount === 1 ? "doc" : "docs"})
        </option>
      ))}
    </select>
  )
}
