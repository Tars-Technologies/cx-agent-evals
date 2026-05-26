"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { SourcePicker, type SourceSelection } from "./SourcePicker";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationFlowProps {
  evaluatorId: Id<"evaluators">;
  agentId: Id<"agents">;
  onClose(): void;
}

type Stage = "select_source" | "configure" | "loop" | "done";

// ─── Deterministic shuffle (seeded LCG) ──────────────────────────────────────

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Transcript viewer ────────────────────────────────────────────────────────

function TranscriptViewer({
  conversationId,
}: {
  conversationId: Id<"conversations">;
}) {
  const messages = useQuery(api.crud.conversations.listMessages, {
    conversationId,
  });

  if (messages === undefined) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded bg-bg-elevated border border-border" />
        ))}
      </div>
    );
  }

  const visible = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  if (visible.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
        No messages in this conversation.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {visible.map((msg) => (
        <div
          key={msg._id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
              msg.role === "user"
                ? "bg-accent/20 text-text"
                : "bg-bg-elevated border border-border text-text"
            }`}
          >
            <p className="text-[10px] text-text-dim mb-1 capitalize">{msg.role}</p>
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stage 1: select_source ───────────────────────────────────────────────────

function SelectSourceStage({
  agentId,
  value,
  onChange,
  onNext,
  onClose,
}: {
  agentId: Id<"agents">;
  value: SourceSelection;
  onChange(s: SourceSelection): void;
  onNext(): void;
  onClose(): void;
}) {
  const hasSelection = value.kinds.size > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-text mb-1">Select conversation sources</h3>
        <p className="text-xs text-text-dim">
          Choose which conversation pools to draw samples from.
          Transcript sources are not yet supported for calibration.
        </p>
      </div>

      <SourcePicker agentId={agentId} value={value} onChange={onChange} />

      <div className="flex justify-between pt-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-surface transition-colors text-text-dim"
        >
          Cancel
        </button>
        <button
          onClick={onNext}
          disabled={!hasSelection}
          className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Stage 2: configure ───────────────────────────────────────────────────────

function ConfigureStage({
  sampleSize,
  setSampleSize,
  trainPct,
  setTrainPct,
  devPct,
  setDevPct,
  testPct,
  setTestPct,
  onBack,
  onStart,
  onClose,
}: {
  sampleSize: number;
  setSampleSize(n: number): void;
  trainPct: number;
  setTrainPct(n: number): void;
  devPct: number;
  setDevPct(n: number): void;
  testPct: number;
  setTestPct(n: number): void;
  onBack(): void;
  onStart(): void;
  onClose(): void;
}) {
  const sum = trainPct + devPct + testPct;
  const sumOk = sum === 100;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-text mb-1">Configure calibration</h3>
        <p className="text-xs text-text-dim">
          Set how many conversations to label and how to split them across train/dev/test.
        </p>
      </div>

      {/* Sample size */}
      <div>
        <label className="block text-xs text-text-dim mb-1">Sample size</label>
        <input
          type="number"
          min={1}
          max={500}
          value={sampleSize}
          onChange={(e) => setSampleSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-32 bg-bg-surface border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
        />
      </div>

      {/* Split ratios */}
      <div>
        <label className="block text-xs text-text-dim mb-2">
          Split ratios{" "}
          <span className={sumOk ? "text-accent" : "text-red-400"}>
            (sum = {sum}%)
          </span>
        </label>
        <div className="flex items-center gap-3">
          {[
            { label: "Train", value: trainPct, set: setTrainPct },
            { label: "Dev", value: devPct, set: setDevPct },
            { label: "Test", value: testPct, set: setTestPct },
          ].map(({ label, value, set }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-text-dim">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={(e) => set(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-20 bg-bg-surface border border-border rounded px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-accent"
              />
              <span className="text-[10px] text-text-dim">%</span>
            </div>
          ))}
        </div>
        {!sumOk && (
          <p className="text-[10px] text-red-400 mt-1">Ratios must sum to 100%</p>
        )}
      </div>

      <div className="flex justify-between pt-2">
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-surface transition-colors text-text-dim"
          >
            Cancel
          </button>
          <button
            onClick={onBack}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-surface transition-colors text-text"
          >
            Back
          </button>
        </div>
        <button
          onClick={onStart}
          disabled={!sumOk}
          className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40"
        >
          Start calibration
        </button>
      </div>
    </div>
  );
}

// ─── Stage 3: loop ────────────────────────────────────────────────────────────

function LoopStage({
  evaluatorId,
  candidates,
  sampleSize,
  trainPct,
  devPct,
  onDone,
}: {
  evaluatorId: Id<"evaluators">;
  candidates: Id<"conversations">[];
  sampleSize: number;
  trainPct: number;
  devPct: number;
  onDone(stats: { pass: number; fail: number; skipped: number; trainN: number; devN: number; testN: number }): void;
}) {
  const upsertLabel = useMutation(api.evaluator.labels.upsert);

  const [index, setIndex] = useState(0);
  const [passCount, setPassCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const total = Math.min(sampleSize, candidates.length);
  const conversationId = candidates[index] as Id<"conversations"> | undefined;

  // Evaluator details for rubric reminder
  const evaluator = useQuery(api.evaluator.crud.get, { id: evaluatorId });

  function getSplitAssignment(i: number): "train" | "dev" | "test" {
    const pct = (i / total) * 100;
    if (pct < trainPct) return "train";
    if (pct < trainPct + devPct) return "dev";
    return "test";
  }

  function advance(p: number, f: number, s: number) {
    const next = index + 1;
    if (next >= total) {
      const trainN = Math.round((trainPct / 100) * total);
      const devN = Math.round((devPct / 100) * total);
      const testN = total - trainN - devN;
      onDone({ pass: p, fail: f, skipped: s, trainN, devN, testN });
    } else {
      setIndex(next);
    }
  }

  async function handleVerdict(verdict: "pass" | "fail") {
    if (!conversationId || submitting) return;
    setSubmitting(true);
    try {
      const splitAssignment = getSplitAssignment(index);
      await upsertLabel({
        evaluatorId,
        source: { kind: "conversation", conversationId },
        humanLabel: verdict,
        splitAssignment,
        origin: { kind: "calibration_pass" },
      });
    } catch {
      // silently ignore — advance anyway to avoid getting stuck
    } finally {
      setSubmitting(false);
      const newPass = verdict === "pass" ? passCount + 1 : passCount;
      const newFail = verdict === "fail" ? failCount + 1 : failCount;
      if (verdict === "pass") setPassCount(newPass);
      else setFailCount(newFail);
      advance(newPass, newFail, skippedCount);
    }
  }

  function handleSkip() {
    const newSkipped = skippedCount + 1;
    setSkippedCount(newSkipped);
    advance(passCount, failCount, newSkipped);
  }

  function finalize() {
    const trainN = Math.round((trainPct / 100) * total);
    const devN = Math.round((devPct / 100) * total);
    const testN = total - trainN - devN;
    onDone({ pass: passCount, fail: failCount, skipped: skippedCount, trainN, devN, testN });
  }

  if (index >= total) {
    // Edge case: finalize was called but state transitions are async; show loader briefly
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
        Finishing…
      </div>
    );
  }

  const judgeInfo = evaluator?.llmJudgeConfig?.dimensions[0];
  const rubricPreview = judgeInfo?.rubric
    ? judgeInfo.rubric.length > 120
      ? judgeInfo.rubric.slice(0, 120) + "…"
      : judgeInfo.rubric
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <div className="flex justify-between text-[10px] text-text-dim mb-1">
          <span>Conversation {index + 1} of {total}</span>
          <span>{passCount} pass · {failCount} fail · {skippedCount} skipped</span>
        </div>
        <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${((index) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Judge rubric reminder */}
      {rubricPreview && (
        <div className="px-4 py-2 flex-shrink-0 border-b border-border">
          <p className="text-[10px] text-text-dim">
            <span className="text-text font-medium">{evaluator?.name}</span>
            {" — "}{rubricPreview}
          </p>
        </div>
      )}

      {/* Transcript */}
      {conversationId ? (
        <TranscriptViewer conversationId={conversationId} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
          No conversation available.
        </div>
      )}

      {/* Action row */}
      <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={() => finalize()}
          className="px-3 py-1.5 text-[10px] border border-border rounded hover:bg-bg-surface transition-colors text-text-dim"
        >
          Stop calibration
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-surface transition-colors text-text-dim disabled:opacity-40"
          >
            Skip
          </button>
          <button
            onClick={() => handleVerdict("fail")}
            disabled={submitting}
            className="px-4 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors disabled:opacity-40"
          >
            Fail
          </button>
          <button
            onClick={() => handleVerdict("pass")}
            disabled={submitting}
            className="px-4 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            Pass
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage 4: done ────────────────────────────────────────────────────────────

function DoneStage({
  stats,
  onClose,
}: {
  stats: { pass: number; fail: number; skipped: number; trainN: number; devN: number; testN: number };
  onClose(): void;
}) {
  const total = stats.pass + stats.fail + stats.skipped;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold text-text mb-1">Calibration complete</h3>
        <p className="text-xs text-text-dim">
          Calibrated {total} conversation{total !== 1 ? "s" : ""}:{" "}
          <span className="text-accent">{stats.pass} pass</span>,{" "}
          <span className="text-red-400">{stats.fail} fail</span>,{" "}
          <span className="text-text-dim">{stats.skipped} skipped</span>.
        </p>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-2">
        <p className="text-xs font-medium text-text mb-2">Split assignment</p>
        {[
          { label: "Train", value: stats.trainN },
          { label: "Dev", value: stats.devN },
          { label: "Test", value: stats.testN },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-text-dim">{label}</span>
            <span className="text-text font-medium">{value}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Main CalibrationFlow ─────────────────────────────────────────────────────

export function CalibrationFlow({
  evaluatorId,
  agentId,
  onClose,
}: CalibrationFlowProps) {
  const [stage, setStage] = useState<Stage>("select_source");
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>({
    kinds: new Set(),
  });
  const [sampleSize, setSampleSize] = useState(30);
  const [trainPct, setTrainPct] = useState(60);
  const [devPct, setDevPct] = useState(20);
  const [testPct, setTestPct] = useState(20);
  const [candidates, setCandidates] = useState<Id<"conversations">[]>([]);
  const [doneStats, setDoneStats] = useState<{
    pass: number;
    fail: number;
    skipped: number;
    trainN: number;
    devN: number;
    testN: number;
  } | null>(null);

  // Evaluator (for splitSeed)
  const evaluator = useQuery(api.evaluator.crud.get, { id: evaluatorId });

  // Candidate queries — always call hooks, pass skip-sentinel when not needed
  const wantsReal = sourceSelection.kinds.has("real");
  const wantsSim = sourceSelection.kinds.has("simulation");

  const realConvs = useQuery(
    api.crud.conversations.listByAgentAndSource,
    wantsReal ? { agentId, source: "playground" } : "skip",
  );
  const simConvs = useQuery(
    api.crud.conversations.listByAgentAndSource,
    wantsSim ? { agentId, source: "simulation" } : "skip",
  );

  // Build shuffled candidate list when starting calibration
  function buildCandidates(): Id<"conversations">[] {
    const pool: Id<"conversations">[] = [];
    if (wantsReal && realConvs) pool.push(...realConvs.map((c) => c._id));
    if (wantsSim && simConvs) pool.push(...simConvs.map((c) => c._id));

    // Dedupe
    const seen = new Set<string>();
    const deduped = pool.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const seed = evaluator?.splitSeed ?? 42;
    return seededShuffle(deduped, seed).slice(0, sampleSize);
  }

  function handleStartCalibration() {
    const built = buildCandidates();
    setCandidates(built);
    setStage("loop");
  }

  const isLoopStage = stage === "loop";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div
        className={`bg-bg-elevated border border-border rounded-lg shadow-2xl w-full flex flex-col ${
          isLoopStage ? "max-w-3xl max-h-[90vh]" : "max-w-lg"
        }`}
        style={isLoopStage ? { height: "90vh" } : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Calibrate fresh sample</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-bg-surface"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className={`flex flex-col ${isLoopStage ? "flex-1 overflow-hidden" : "p-5"}`}>
          {stage === "select_source" && (
            <SelectSourceStage
              agentId={agentId}
              value={sourceSelection}
              onChange={setSourceSelection}
              onNext={() => setStage("configure")}
              onClose={onClose}
            />
          )}

          {stage === "configure" && (
            <ConfigureStage
              sampleSize={sampleSize}
              setSampleSize={setSampleSize}
              trainPct={trainPct}
              setTrainPct={setTrainPct}
              devPct={devPct}
              setDevPct={setDevPct}
              testPct={testPct}
              setTestPct={setTestPct}
              onBack={() => setStage("select_source")}
              onStart={handleStartCalibration}
              onClose={onClose}
            />
          )}

          {stage === "loop" && (
            <LoopStage
              evaluatorId={evaluatorId}
              candidates={candidates}
              sampleSize={sampleSize}
              trainPct={trainPct}
              devPct={devPct}
              onDone={(stats) => {
                setDoneStats(stats);
                setStage("done");
              }}
            />
          )}

          {stage === "done" && doneStats && (
            <DoneStage stats={doneStats} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
