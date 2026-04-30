"use client";

import type { OptionDef } from "rag-evaluation-system/registry";
import { InfoTooltip } from "./InfoTooltip";

interface OptionFieldProps {
  option: OptionDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

export function OptionField({
  option,
  value,
  onChange,
  disabled = false,
}: OptionFieldProps) {
  const wrapperClass = disabled ? "opacity-50 pointer-events-none" : "";

  return (
    <div className={wrapperClass}>
      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-xs font-medium text-text">
          {option.label}
        </label>
        {option.description && <InfoTooltip text={option.description} />}
      </div>

      {/* Input */}
      {renderInput(option, value, onChange)}

      {/* Description */}
      <p className="mt-1 text-xs text-text-muted">{option.description}</p>
    </div>
  );
}

function renderInput(
  option: OptionDef,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
) {
  const baseInputClass =
    "w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 " +
    "focus:outline-none focus:border-accent/50 transition-colors";

  switch (option.type) {
    case "select":
      return (
        <select
          value={String(value ?? option.default ?? "")}
          onChange={(e) => onChange(option.key, e.target.value)}
          className={`${baseInputClass} cursor-pointer`}
        >
          {option.choices?.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );

    case "number": {
      const numericValue =
        value != null
          ? Number(value)
          : option.default != null
            ? Number(option.default)
            : "";
      return (
        <input
          type="number"
          value={numericValue}
          min={option.constraints?.min}
          max={option.constraints?.max}
          step={option.constraints?.step}
          onChange={(e) =>
            onChange(
              option.key,
              e.target.value === "" ? undefined : Number(e.target.value),
            )
          }
          className={baseInputClass}
        />
      );
    }

    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value ?? option.default)}
            onChange={(e) => onChange(option.key, e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border bg-bg-surface text-accent focus:ring-accent/50"
          />
          <span className="text-xs text-text-muted">
            {Boolean(value ?? option.default) ? "Enabled" : "Disabled"}
          </span>
        </label>
      );

    case "string": {
      const isTextArea =
        option.description?.toLowerCase().includes("prompt") ?? false;

      if (isTextArea) {
        return (
          <textarea
            value={String(value ?? option.default ?? "")}
            onChange={(e) => onChange(option.key, e.target.value)}
            rows={4}
            className={`${baseInputClass} resize-y`}
          />
        );
      }

      return (
        <input
          type="text"
          value={String(value ?? option.default ?? "")}
          onChange={(e) => onChange(option.key, e.target.value)}
          className={baseInputClass}
        />
      );
    }
  }
}
