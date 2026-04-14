"use client";

interface PriorityDotsProps {
  value: number;
  onChange: (priority: number) => void;
}

export function PriorityDots({ value, onChange }: PriorityDotsProps) {
  return (
    <div className="flex items-center gap-[3px]">
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onChange(level)}
          className="w-2 h-2 rounded-full transition-colors"
          style={{
            backgroundColor: level <= value
              ? "var(--color-accent)"
              : "var(--color-border)",
          }}
          onMouseEnter={(e) => {
            if (level > value) {
              e.currentTarget.style.backgroundColor = "var(--color-border-bright)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = level <= value
              ? "var(--color-accent)"
              : "var(--color-border)";
          }}
          aria-label={`Set priority to ${level}`}
        />
      ))}
    </div>
  );
}
