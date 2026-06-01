"use client"

import type { Id } from "@convex/_generated/dataModel"
import { useQuery } from "convex/react"
import type { ReactNode } from "react"
import { api } from "@/lib/convex"

export interface DocSearchHit {
  _id: Id<"documents">
  docId: string
  title: string
  contentLength: number
  sourceType?: string
  priority?: number
}

interface DocSearchResultsProps {
  kbId: Id<"knowledgeBases">
  query: string
  limit?: number
  /** Renders one result row. */
  renderRow: (doc: DocSearchHit) => ReactNode
  /** Visual variant: "popover" floats above siblings; "inline" sits in flow. */
  variant?: "popover" | "inline"
}

export function DocSearchResults({
  kbId,
  query,
  limit = 20,
  renderRow,
  variant = "popover"
}: DocSearchResultsProps) {
  const trimmed = query.trim()
  const results = useQuery(
    api.crud.documents.searchDocsByTitle,
    trimmed ? { kbId, query: trimmed, limit } : "skip"
  )

  if (!trimmed) return null

  const containerCls =
    variant === "popover"
      ? "absolute z-20 left-0 right-0 mt-1 bg-bg-elevated border border-border rounded shadow-lg max-h-[240px] overflow-y-auto"
      : "bg-bg-surface border-b border-border max-h-[180px] overflow-y-auto"

  if (results === undefined) {
    return (
      <div className={`${containerCls} px-3 py-2 text-[10px] text-text-dim`}>
        Searching…
      </div>
    )
  }
  if (results.length === 0) {
    return (
      <div className={`${containerCls} px-3 py-2 text-[10px] text-text-dim`}>
        No matches.
      </div>
    )
  }

  return <div className={containerCls}>{results.map(renderRow)}</div>
}
