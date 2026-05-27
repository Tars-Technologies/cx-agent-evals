"use client"

import type { Dimension } from "@/lib/types"

export function DimensionSummary({
  dimensions,
  totalQuestions,
  onEdit
}: {
  dimensions: Dimension[]
  totalQuestions: number
  onEdit: () => void
}) {
  const totalValues = dimensions.reduce((sum, d) => sum + d.values.length, 0)

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-text-muted">
          {dimensions.length} dimensions &middot; {totalValues} values
        </span>
        <button
          onClick={onEdit}
          className="text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer uppercase tracking-wider font-semibold"
        >
          Edit
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {dimensions.map((dim) => (
          <span
            key={dim.name}
            className="px-2 py-0.5 rounded text-[10px] bg-accent/8 border border-accent/20 text-accent/80"
          >
            {dim.name}
          </span>
        ))}
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">
          Total questions
        </label>
        <span className="text-sm text-text">{totalQuestions}</span>
      </div>
    </div>
  )
}
