"use client";

import type { UnifiedWizardConfig } from "@/lib/types";
import { PriorityDots } from "./PriorityDots";

interface DocInfo {
  _id: string;
  docId: string;
  title: string;
  priority: number;
}

interface WizardStepReviewProps {
  config: UnifiedWizardConfig;
  documents: DocInfo[];
  onTotalQuestionsChange: (n: number) => void;
  onPriorityChange: (docId: string, priority: number) => void;
  onGenerate: () => void;
  onBack: () => void;
  onEditStep: (step: number) => void;
  generating: boolean;
  disabled: boolean;
  disabledReason?: string;
}

export function WizardStepReview({
  config,
  documents,
  onTotalQuestionsChange,
  onPriorityChange,
  onGenerate,
  onBack,
  onEditStep,
  generating,
  disabled,
  disabledReason,
}: WizardStepReviewProps) {
  const totalWeight = documents.reduce((s, d) => s + d.priority, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <span className="text-xs text-text-dim uppercase tracking-wider">Review &amp; Generate</span>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard
          label="Real-World Qs"
          value={config.realWorldQuestions.length > 0 ? `${config.realWorldQuestions.length} provided` : "Skipped"}
          onEdit={() => onEditStep(0)}
        />
        <SummaryCard
          label="Dimensions"
          value={config.dimensions.length > 0 ? `${config.dimensions.length} configured` : "Skipped"}
          onEdit={() => onEditStep(1)}
        />
        <SummaryCard
          label="Preferences"
          value={`${config.preferences.questionTypes.length} types, ${config.preferences.tone}`}
          onEdit={() => onEditStep(2)}
        />
      </div>

      {/* Total questions slider */}
      <div>
        <label className="text-xs text-text-dim mb-1.5 block">Total Questions</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={200}
            value={config.totalQuestions}
            onChange={(e) => onTotalQuestionsChange(parseInt(e.target.value))}
            className="flex-1"
          />
          <span className="text-sm font-mono text-accent w-8 text-right">{config.totalQuestions}</span>
        </div>
      </div>

      {/* Document priority table */}
      {documents.length > 0 && (
        <div>
          <label className="text-xs text-text-dim mb-1.5 block">Document Priority &amp; Allocation</label>
          <div className="border border-border rounded max-h-[360px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-secondary z-10">
                <tr>
                  <th className="text-left px-3 py-1.5 text-text-dim font-normal">Document</th>
                  <th className="text-center px-3 py-1.5 text-text-dim font-normal w-24">Priority</th>
                  <th className="text-right px-3 py-1.5 text-text-dim font-normal w-16">Alloc.</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const alloc = totalWeight > 0
                    ? Math.round((doc.priority / totalWeight) * config.totalQuestions)
                    : 0;
                  return (
                    <tr key={doc._id} className="border-t border-border">
                      <td className="px-3 py-1.5 text-text truncate max-w-[200px]">{doc.title}</td>
                      <td className="px-3 py-1.5 text-center">
                        <PriorityDots value={doc.priority} onChange={(p) => onPriorityChange(doc._id, p)} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-dim">{alloc}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center pt-2">
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-dim hover:text-text transition-colors">← Back</button>
        <button
          onClick={onGenerate}
          disabled={disabled || generating}
          title={disabledReason}
          className="px-4 py-2 text-sm rounded bg-accent text-bg font-medium hover:bg-accent-bright transition-colors disabled:opacity-40"
        >
          {generating ? "Generating..." : "Generate Questions"}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="p-2 border border-border rounded">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-dim uppercase">{label}</span>
        <button onClick={onEdit} className="text-[10px] text-accent hover:text-accent-bright">Edit</button>
      </div>
      <div className="text-xs text-text mt-0.5 truncate">{value}</div>
    </div>
  );
}
