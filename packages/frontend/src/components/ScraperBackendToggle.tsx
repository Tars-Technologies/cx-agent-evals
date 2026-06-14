"use client"

export type ScraperBackend = "inprocess" | "tarser" | "asimov"

interface Props {
  value: ScraperBackend
  onChange: (b: ScraperBackend) => void
  tarserAvailable: boolean
  asimovAvailable: boolean
  disabled?: boolean
  /** Availability query has not resolved yet — show "checking" instead of "unavailable". */
  loading?: boolean
}

/**
 * Native vs remote (Tarser / Asimov) segmented control. Remote options are always
 * rendered but disabled with a "not available right now" hint when that backend is
 * unconfigured. While availability is still loading they show a neutral "checking" hint.
 */
export function ScraperBackendToggle({
  value,
  onChange,
  tarserAvailable,
  asimovAvailable,
  disabled,
  loading
}: Props) {
  const remoteButton = (
    backend: "tarser" | "asimov",
    label: string,
    available: boolean
  ) => (
    <button
      type="button"
      disabled={disabled || loading || !available}
      title={
        loading
          ? "checking availability..."
          : available
            ? undefined
            : "not available right now"
      }
      onClick={() => available && onChange(backend)}
      className={`px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        value === backend
          ? "bg-accent text-bg-elevated border-accent"
          : "border-border text-text-dim hover:text-text"
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-1">
      <label className="text-xs text-text-muted uppercase tracking-wide">
        Backend
      </label>
      <div className="flex gap-2 flex-wrap">
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
        {remoteButton("tarser", "Tarser", tarserAvailable)}
        {remoteButton("asimov", "Asimov", asimovAvailable)}
        {loading && (
          <span className="self-center text-xs text-text-dim">
            Checking availability...
          </span>
        )}
      </div>
    </div>
  )
}
