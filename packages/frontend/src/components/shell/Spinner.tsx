interface SpinnerProps {
  size?: "sm" | "md";
  label?: string;
}

export function Spinner({ size = "sm", label }: SpinnerProps) {
  const dim = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  return (
    <span className="inline-flex items-center gap-2 text-text-dim text-xs">
      <span
        className={`${dim} border-2 border-accent/30 border-t-accent rounded-full animate-spin`}
      />
      {label && <span>{label}</span>}
    </span>
  );
}
