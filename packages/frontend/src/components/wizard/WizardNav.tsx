"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardNavProps {
  currentStep: number;
  totalSteps: number; // always 6
  onStepClick: (step: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS = ["Preset", "Index", "Query", "Search", "Refinement", "Review"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WizardNav({ currentStep, totalSteps, onStepClick }: WizardNavProps) {
  return (
    <nav className="flex items-center gap-0 px-4 py-3" aria-label="Wizard steps">
      {Array.from({ length: totalSteps }, (_, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <div key={i} className="flex items-center flex-1 last:flex-initial">
            {/* Circle + label */}
            <button
              type="button"
              onClick={() => onStepClick(i)}
              className="flex flex-col items-center gap-1 cursor-pointer group"
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${STEP_LABELS[i]}`}
            >
              <span
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium
                  transition-colors
                  ${isCurrent ? "border-2 border-accent text-accent" : ""}
                  ${isCompleted ? "bg-accent text-bg" : ""}
                  ${!isCurrent && !isCompleted ? "border border-border text-text-dim" : ""}
                `}
              >
                {i + 1}
              </span>
              <span
                className={`
                  text-xs transition-colors
                  ${isCurrent ? "text-accent" : "text-text-muted"}
                `}
              >
                {STEP_LABELS[i]}
              </span>
            </button>

            {/* Connecting line (not after the last step) */}
            {i < totalSteps - 1 && (
              <div className="h-px bg-border flex-1 mx-1 self-start mt-3.5" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
