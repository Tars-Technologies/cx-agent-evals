"use client";

import { useState } from "react";
import type { OptionDef } from "rag-evaluation-system/registry";
import { OptionField } from "./OptionField";

interface OptionGroupProps {
  options: readonly OptionDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

export function OptionGroup({
  options,
  values,
  onChange,
  disabled = false,
}: OptionGroupProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const regularOptions = options.filter((o) => !o.advanced);
  const advancedOptions = options.filter((o) => o.advanced);

  return (
    <div className="flex flex-col gap-4">
      {/* Regular options */}
      {regularOptions.map((option) => (
        <OptionField
          key={option.key}
          option={option}
          value={values[option.key]}
          onChange={onChange}
          disabled={disabled}
        />
      ))}

      {/* Advanced options (collapsible) */}
      {advancedOptions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="
              flex items-center gap-1.5
              text-xs text-text-dim
              hover:text-text-muted
              transition-colors cursor-pointer
            "
          >
            <span className="text-[10px]">
              {showAdvanced ? "\u25BE" : "\u25B8"}
            </span>
            Advanced
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-4 pl-3 border-l border-border">
              {advancedOptions.map((option) => (
                <OptionField
                  key={option.key}
                  option={option}
                  value={values[option.key]}
                  onChange={onChange}
                  disabled={disabled}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
