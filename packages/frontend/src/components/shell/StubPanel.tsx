import Link from "next/link";

interface StubPanelProps {
  title: string;
  legacyHref?: string;
  legacyLabel?: string;
  note?: string;
}

export function StubPanel({ title, legacyHref, legacyLabel, note }: StubPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated/40 p-8">
      <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
      <p className="text-xs text-text-muted mb-4">
        {note ?? "Placeholder — moves here in the section PR. Shell + routing only in this PR."}
      </p>
      {legacyHref && (
        <Link
          href={legacyHref}
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-bright transition-colors"
        >
          → {legacyLabel ?? "Open legacy route"}
        </Link>
      )}
    </div>
  );
}
