"use client";

import type { PromptPreferences } from "@/lib/types";

const QUESTION_TYPES = ["factoid", "procedural", "comparison", "conditional", "yes/no", "open-ended"];
const TONES = ["professional but accessible", "casual", "technical", "conversational"];

interface WizardStepPreferencesProps {
  preferences: PromptPreferences;
  onChange: (prefs: PromptPreferences) => void;
  onNext: () => void;
  onBack: () => void;
}

export function WizardStepPreferences({ preferences, onChange, onNext, onBack }: WizardStepPreferencesProps) {
  const toggleType = (type: string) => {
    const types = preferences.questionTypes.includes(type)
      ? preferences.questionTypes.filter(t => t !== type)
      : [...preferences.questionTypes, type];
    onChange({ ...preferences, questionTypes: types });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <span className="text-xs text-text-dim uppercase tracking-wider">Generation Preferences</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Question types */}
        <div>
          <label className="text-xs text-text-dim mb-1.5 block">Question Types</label>
          <div className="flex flex-wrap gap-1.5">
            {QUESTION_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  preferences.questionTypes.includes(type)
                    ? "border-accent bg-accent-dim text-accent-bright"
                    : "border-border text-text-dim hover:border-border-bright"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Tone */}
        <div>
          <label className="text-xs text-text-dim mb-1.5 block">Tone</label>
          <select
            value={preferences.tone}
            onChange={(e) => onChange({ ...preferences, tone: e.target.value })}
            className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent-dim"
          >
            {TONES.map((tone) => (
              <option key={tone} value={tone}>{tone}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Focus areas — full row */}
      <div>
        <label className="text-xs text-text-dim mb-1.5 block">Focus Areas</label>
        <input
          type="text"
          value={preferences.focusAreas}
          onChange={(e) => onChange({ ...preferences, focusAreas: e.target.value })}
          placeholder="e.g., API integration, authentication, billing"
          className="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent-dim"
        />
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors">← Back</button>
        <button onClick={onNext} className="px-3 py-1.5 text-xs rounded bg-accent-dim text-accent-bright hover:bg-accent/20 transition-colors">Next →</button>
      </div>
    </div>
  );
}
