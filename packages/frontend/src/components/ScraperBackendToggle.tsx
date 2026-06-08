"use client"

export type ScraperBackend = "inprocess" | "tarser"

interface Props {
  value: ScraperBackend
  onChange: (b: ScraperBackend) => void
  tarserAvailable: boolean
  disabled?: boolean
}

/**
 * Native vs Tarser segmented control. The Tarser option is always rendered but
 * disabled with a "not available right now" hint when Tarser is unconfigured.
 */
export function ScraperBackendToggle({
  value,
  onChange,
  tarserAvailable,
  disabled
}: Props) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-muted uppercase tracking-wide">
        Backend
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("inprocess")}
          className={`px-3 py-1.5 text-sm rounded border transition-colors ${
            value === "inprocess"
              ? "bg-accent text-bg-elevated border-accent"
              : "border-border text-text-dim hover:text-text"
          }`}
        >
          Native
        </button>
        <button
          type="button"
          disabled={disabled || !tarserAvailable}
          title={tarserAvailable ? undefined : "not available right now"}
          onClick={() => tarserAvailable && onChange("tarser")}
          className={`px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            value === "tarser"
              ? "bg-accent text-bg-elevated border-accent"
              : "border-border text-text-dim hover:text-text"
          }`}
        >
          Tarser
        </button>
        {!tarserAvailable && (
          <span className="self-center text-xs text-text-dim">
            Tarser not available right now
          </span>
        )}
      </div>
    </div>
  )
}
