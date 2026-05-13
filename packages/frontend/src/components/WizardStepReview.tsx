"use client";

import { useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import type { UnifiedWizardConfig } from "@/lib/types";
import { PriorityDots } from "./PriorityDots";
import { DocSearchResults } from "./DocSearchResults";
import { DEFAULT_PRIORITY } from "./GenerationWizard";

interface CustomizedDoc {
  _id: Id<"documents">;
  docId: string;
  title: string;
  priority?: number;
}

interface WizardStepReviewProps {
  kbId: Id<"knowledgeBases">;
  config: UnifiedWizardConfig;
  totalDocCount: number;
  customizedDocs: CustomizedDoc[];
  onTotalQuestionsChange: (n: number) => void;
  onPriorityChange: (documentId: Id<"documents">, priority: number) => void;
  onGenerate: () => void;
  onBack: () => void;
  onEditStep: (step: number) => void;
  generating: boolean;
  disabled: boolean;
  disabledReason?: string;
}

/**
 * Compute per-customized-doc allocation. All uncustomized docs share the
 * default priority; we report their combined allocation as a single "+ N
 * more at default" row rather than per-doc, since the wizard never sees
 * them individually.
 */
function calculateAllocations(
  customized: CustomizedDoc[],
  totalDocCount: number,
  totalQuestions: number,
): { perDoc: Map<string, number>; defaultBucketAlloc: number; defaultBucketCount: number } {
  const customizedCount = customized.length;
  const defaultBucketCount = Math.max(0, totalDocCount - customizedCount);

  const customizedWeight = customized.reduce(
    (s, d) => s + (d.priority ?? DEFAULT_PRIORITY),
    0,
  );
  const defaultBucketWeight = defaultBucketCount * DEFAULT_PRIORITY;
  const totalWeight = customizedWeight + defaultBucketWeight;

  const perDoc = new Map<string, number>();
  if (totalWeight === 0 || totalQuestions === 0) {
    return { perDoc, defaultBucketAlloc: 0, defaultBucketCount };
  }

  let allocated = 0;
  for (const d of customized) {
    const p = d.priority ?? DEFAULT_PRIORITY;
    const q = Math.round((p / totalWeight) * totalQuestions);
    perDoc.set(d._id, q);
    allocated += q;
  }
  const defaultBucketAlloc = Math.max(0, totalQuestions - allocated);
  return { perDoc, defaultBucketAlloc, defaultBucketCount };
}

export function WizardStepReview({
  kbId,
  config,
  totalDocCount,
  customizedDocs,
  onTotalQuestionsChange,
  onPriorityChange,
  onGenerate,
  onBack,
  onEditStep,
  generating,
  disabled,
  disabledReason,
}: WizardStepReviewProps) {
  const { perDoc, defaultBucketAlloc, defaultBucketCount } = calculateAllocations(
    customizedDocs,
    totalDocCount,
    config.totalQuestions,
  );

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

      {/* Document priority section */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-xs text-text-dim">Document Priority &amp; Allocation</label>
          <span className="text-[10px] text-text-dim">
            {totalDocCount.toLocaleString()} doc{totalDocCount !== 1 ? "s" : ""} ·
            {" "}{customizedDocs.length} customized ·
            {" "}{defaultBucketCount.toLocaleString()} at default
          </span>
        </div>

        <DocSearchBar kbId={kbId} onPriorityChange={onPriorityChange} />

        <div className="mt-2 border border-border rounded max-h-[300px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary z-10">
              <tr>
                <th className="text-left px-3 py-1.5 text-text-dim font-normal">Document</th>
                <th className="text-center px-3 py-1.5 text-text-dim font-normal w-24">Priority</th>
                <th className="text-right px-3 py-1.5 text-text-dim font-normal w-16">Alloc.</th>
              </tr>
            </thead>
            <tbody>
              {customizedDocs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-text-dim">
                    No customized priorities. All docs allocated equally — use the
                    search above to bump or lower specific docs.
                  </td>
                </tr>
              ) : (
                customizedDocs.map((doc) => {
                  const alloc = perDoc.get(doc._id) ?? 0;
                  return (
                    <tr key={doc._id} className="border-t border-border">
                      <td className="px-3 py-1.5 text-text truncate max-w-[200px]">
                        {doc.title}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <PriorityDots
                          value={doc.priority ?? DEFAULT_PRIORITY}
                          onChange={(p) => onPriorityChange(doc._id, p)}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-text-dim">
                        {alloc}
                      </td>
                    </tr>
                  );
                })
              )}
              {defaultBucketCount > 0 && (
                <tr className="border-t border-border bg-bg-surface/40">
                  <td className="px-3 py-1.5 text-text-dim italic">
                    + {defaultBucketCount.toLocaleString()} more doc
                    {defaultBucketCount !== 1 ? "s" : ""} at default priority
                  </td>
                  <td className="px-3 py-1.5 text-center text-text-dim">{DEFAULT_PRIORITY}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-text-dim">
                    {defaultBucketAlloc}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-bright">
                <td className="px-3 py-2 text-text-muted text-xs font-medium">Total</td>
                <td className="px-3 py-2 text-center"></td>
                <td className="px-3 py-2 text-right font-mono text-accent text-xs font-medium">
                  {config.totalQuestions}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

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

function DocSearchBar({
  kbId,
  onPriorityChange,
}: {
  kbId: Id<"knowledgeBases">;
  onPriorityChange: (documentId: Id<"documents">, priority: number) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search for a document to customize its priority…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
      />
      <DocSearchResults
        kbId={kbId}
        query={query}
        limit={10}
        renderRow={(r) => (
          <div
            key={r._id}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-border last:border-b-0 hover:bg-bg-hover"
          >
            <span className="flex-1 text-xs text-text truncate">{r.title}</span>
            <PriorityDots
              value={r.priority ?? DEFAULT_PRIORITY}
              onChange={(p) => onPriorityChange(r._id, p)}
            />
          </div>
        )}
      />
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
