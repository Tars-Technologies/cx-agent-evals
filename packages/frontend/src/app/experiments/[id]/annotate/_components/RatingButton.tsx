"use client";

export function RatingButton({
  label,
  shortcut,
  active,
  color,
  onClick,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  color: "accent" | "yellow" | "red";
  onClick: () => void;
}) {
  const colorMap = {
    accent: active
      ? "bg-accent/20 border-accent/50 text-accent"
      : "border-border text-text-dim hover:border-accent/30 hover:text-accent",
    yellow: active
      ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
      : "border-border text-text-dim hover:border-yellow-500/30 hover:text-yellow-400",
    red: active
      ? "bg-red-500/20 border-red-500/50 text-red-400"
      : "border-border text-text-dim hover:border-red-500/30 hover:text-red-400",
  };

  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors ${colorMap[color]}`}
    >
      {label}{" "}
      <span className="text-[10px] opacity-50 ml-1">[{shortcut}]</span>
    </button>
  );
}
