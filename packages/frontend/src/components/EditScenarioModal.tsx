"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface ScenarioData {
  _id: Id<"conversationScenarios">;
  persona: {
    type: string;
    traits: string[];
    communicationStyle: string;
    patienceLevel: "low" | "medium" | "high";
  };
  topic: string;
  intent: string;
  complexity: "low" | "medium" | "high";
  reasonForContact: string;
  knownInfo: string;
  unknownInfo: string;
  instruction: string;
  referenceMessages?: Array<{
    role: "user";
    content: string;
    turnIndex: number;
  }>;
}

export function EditScenarioModal({
  scenario,
  onClose,
}: {
  scenario: ScenarioData;
  onClose: () => void;
}) {
  const updateScenario = useMutation(api.conversationSim.scenarios.update);

  // Editable state
  const [persona, setPersona] = useState(scenario.persona);
  const [topic, setTopic] = useState(scenario.topic);
  const [intent, setIntent] = useState(scenario.intent);
  const [complexity, setComplexity] = useState(scenario.complexity);
  const [reasonForContact, setReasonForContact] = useState(
    scenario.reasonForContact,
  );
  const [knownInfo, setKnownInfo] = useState(scenario.knownInfo);
  const [unknownInfo, setUnknownInfo] = useState(scenario.unknownInfo);
  const [instruction, setInstruction] = useState(scenario.instruction);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track unsaved changes
  const hasChanges =
    topic !== scenario.topic ||
    intent !== scenario.intent ||
    complexity !== scenario.complexity ||
    reasonForContact !== scenario.reasonForContact ||
    knownInfo !== scenario.knownInfo ||
    unknownInfo !== scenario.unknownInfo ||
    instruction !== scenario.instruction ||
    JSON.stringify(persona) !== JSON.stringify(scenario.persona);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateScenario({
        id: scenario._id,
        persona,
        topic,
        intent,
        complexity,
        reasonForContact,
        knownInfo,
        unknownInfo,
        instruction,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">
              Edit Scenario
            </span>
            <span className="text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded font-medium">
              {scenario._id.slice(-4)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-[10px] text-text-dim flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Unsaved changes
              </span>
            )}
            {error && (
              <span className="text-[10px] text-red-400">{error}</span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:bg-bg-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 text-xs font-semibold bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Content - two columns */}
        <div className="overflow-y-auto max-h-[calc(85vh-52px)]">
          <div className="grid grid-cols-2 gap-6 p-6">
            {/* Left column: Metadata */}
            <div className="space-y-4">
              <Field label="Topic">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
                />
              </Field>

              <Field label="Intent">
                <input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
                />
              </Field>

              <Field label="Complexity">
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setComplexity(level)}
                      className={`px-3 py-1 text-xs rounded border transition-colors cursor-pointer ${
                        complexity === level
                          ? "bg-accent/20 text-accent border-accent/30"
                          : "text-text-dim border-border hover:text-text"
                      }`}
                    >
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Reason for Contact">
                <textarea
                  value={reasonForContact}
                  onChange={(e) => setReasonForContact(e.target.value)}
                  rows={2}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none resize-none"
                />
              </Field>

              <Field label="Persona Type">
                <input
                  value={persona.type}
                  onChange={(e) =>
                    setPersona({ ...persona, type: e.target.value })
                  }
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
                />
              </Field>

              <Field label="Traits (comma-separated)">
                <input
                  value={persona.traits.join(", ")}
                  onChange={(e) =>
                    setPersona({
                      ...persona,
                      traits: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
                />
              </Field>

              <Field label="Communication Style">
                <input
                  value={persona.communicationStyle}
                  onChange={(e) =>
                    setPersona({
                      ...persona,
                      communicationStyle: e.target.value,
                    })
                  }
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
                />
              </Field>

              <Field label="Patience Level">
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() =>
                        setPersona({ ...persona, patienceLevel: level })
                      }
                      className={`px-3 py-1 text-xs rounded border transition-colors cursor-pointer ${
                        persona.patienceLevel === level
                          ? "bg-accent/20 text-accent border-accent/30"
                          : "text-text-dim border-border hover:text-text"
                      }`}
                    >
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* Right column: Content fields */}
            <div className="space-y-4">
              <Field label="Known Info">
                <textarea
                  value={knownInfo}
                  onChange={(e) => setKnownInfo(e.target.value)}
                  rows={4}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none resize-none"
                />
              </Field>

              <Field label="Unknown Info">
                <textarea
                  value={unknownInfo}
                  onChange={(e) => setUnknownInfo(e.target.value)}
                  rows={4}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none resize-none"
                />
              </Field>

              <Field label="Instruction">
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={10}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text font-mono focus:border-accent outline-none resize-none"
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border">
          <span className="text-[10px] text-text-dim">
            <kbd className="bg-bg-surface border border-border rounded px-1.5 py-0.5 text-[9px] text-text-muted">
              Esc
            </kbd>{" "}
            to close
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
