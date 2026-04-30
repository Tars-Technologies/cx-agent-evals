"use client";

import type { ReactNode } from "react";

export interface Scenario {
  _id: string;
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
  sourceType?: "transcript_grounded" | "synthetic";
  sourceTranscriptId?: string;
  languages?: string[];
  // ── New: user-simulator fidelity ──
  behaviorAnchors?: string[];
  userMessageLengthStats?: { median: number; p90: number };
  referenceTranscript?: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }>;
  referenceExemplars?: Array<{
    sourceTranscriptId: string;
    messages: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }>;
  }>;
}

export function ScenarioFields({ scenario }: { scenario: Scenario }) {
  return (
    <div className="px-6 py-4 space-y-5">
      {/* Persona Section */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Persona</h3>
        <div className="flex flex-wrap gap-1.5">
          <Chip color="blue">{scenario.persona.type}</Chip>
          <Chip color="purple">{scenario.persona.communicationStyle}</Chip>
          <Chip color={scenario.persona.patienceLevel === "low" ? "red" : scenario.persona.patienceLevel === "high" ? "green" : "yellow"}>
            {scenario.persona.patienceLevel} patience
          </Chip>
          {scenario.persona.traits.map((trait, i) => (
            <Chip key={i} color="gray">{trait}</Chip>
          ))}
        </div>
      </section>

      {/* Source section */}
      {(scenario.sourceType || (scenario.languages && scenario.languages.length > 0)) && (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Source</h3>
          <div className="flex flex-wrap gap-1.5">
            {scenario.sourceType && (
              <Chip color={scenario.sourceType === "transcript_grounded" ? "green" : "purple"}>
                {scenario.sourceType === "transcript_grounded" ? "Transcript-grounded" : "Synthetic"}
              </Chip>
            )}
            {scenario.languages?.map((lang, i) => (
              <Chip key={i} color="blue">{lang}</Chip>
            ))}
          </div>
        </section>
      )}

      {/* Scenario Section */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Scenario</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip color={scenario.complexity === "high" ? "red" : scenario.complexity === "medium" ? "yellow" : "green"}>
            {scenario.complexity} complexity
          </Chip>
        </div>
        <div className="text-xs text-text-dim leading-relaxed">
          <strong className="text-text">Reason for contact:</strong> {scenario.reasonForContact}
        </div>
      </section>

      {/* Known / Unknown Info (side by side) */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Information Boundaries</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-elevated/50 border border-border rounded-md p-3">
            <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1.5">Known Info</div>
            <p className="text-xs text-text-dim leading-relaxed">{scenario.knownInfo}</p>
          </div>
          <div className="bg-bg-elevated/50 border border-border rounded-md p-3">
            <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1.5">Unknown Info</div>
            <p className="text-xs text-text-dim leading-relaxed">{scenario.unknownInfo}</p>
          </div>
        </div>
      </section>

      {/* How this user speaks (new) OR legacy Instruction */}
      {scenario.behaviorAnchors && scenario.behaviorAnchors.length > 0 ? (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">How this user speaks</h3>
          <ul className="space-y-1">
            {scenario.behaviorAnchors.map((a, i) => (
              <li key={i} className="text-xs text-text-dim leading-relaxed flex">
                <span className="text-text-dim mr-2">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
          {scenario.userMessageLengthStats && (
            <div className="mt-2">
              <Chip color="gray">
                Typical length: median {scenario.userMessageLengthStats.median}w / p90 {scenario.userMessageLengthStats.p90}w
              </Chip>
            </div>
          )}
        </section>
      ) : scenario.instruction ? (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Instruction</h3>
          <div className="bg-bg border border-border rounded-md p-3">
            <pre className="text-xs text-text leading-relaxed whitespace-pre-wrap font-mono">
              {scenario.instruction}
            </pre>
          </div>
          {scenario.userMessageLengthStats && (
            <div className="mt-2">
              <Chip color="gray">
                Typical length: median {scenario.userMessageLengthStats.median}w / p90 {scenario.userMessageLengthStats.p90}w
              </Chip>
            </div>
          )}
        </section>
      ) : null}

      {/* Source pane (new fields prefer; legacy fallback) */}
      {scenario.referenceTranscript && scenario.referenceTranscript.length > 0 ? (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Source transcript ({scenario.referenceTranscript.length} messages)
          </h3>
          <div className="text-xs text-text-dim leading-relaxed">
            Open this scenario in a simulation run to compare against the snapshot.
          </div>
        </section>
      ) : scenario.referenceExemplars && scenario.referenceExemplars.length > 0 ? (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Style exemplars ({scenario.referenceExemplars.length})
          </h3>
          <details>
            <summary className="text-xs text-text-dim cursor-pointer select-none">
              Expand to view sampled exchanges
            </summary>
            <div className="mt-2 space-y-2">
              {scenario.referenceExemplars.slice(0, 3).map((ex, i) => (
                <div
                  key={i}
                  className="bg-bg-elevated/50 border border-border rounded-md p-3 pl-4 border-l-2 border-l-purple-500/40"
                >
                  <div className="text-[10px] text-purple-400 uppercase mb-1">Exemplar {i + 1}</div>
                  {ex.messages.map((m, j) => (
                    <div key={j} className="text-xs text-text-dim leading-relaxed mb-0.5">
                      <strong className="text-text">{m.role}:</strong> {m.text}
                    </div>
                  ))}
                </div>
              ))}
              {scenario.referenceExemplars.length > 3 && (
                <div className="text-[10px] text-text-dim">
                  + {scenario.referenceExemplars.length - 3} more exemplars
                </div>
              )}
            </div>
          </details>
        </section>
      ) : scenario.referenceMessages && scenario.referenceMessages.length > 0 ? (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Reference Messages ({scenario.referenceMessages.length})
          </h3>
          <div className="space-y-2">
            {scenario.referenceMessages.map((msg, i) => (
              <div
                key={i}
                className="bg-bg-elevated/50 border border-border rounded-md p-3 pl-4 border-l-2 border-l-blue-500/40"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-blue-400 uppercase">Turn {msg.turnIndex}</span>
                  <span className="text-[10px] text-text-dim">{msg.role}</span>
                </div>
                <p className="text-xs text-text-dim leading-relaxed">{msg.content}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function Chip({
  children,
  color,
}: {
  children: ReactNode;
  color: "blue" | "purple" | "red" | "yellow" | "green" | "gray";
}) {
  const colorMap = {
    blue: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    red: "bg-red-500/15 text-red-400 border-red-500/20",
    yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    green: "bg-green-500/15 text-green-400 border-green-500/20",
    gray: "bg-white/5 text-text-dim border-border",
  };

  return (
    <span className={`px-1.5 py-0.5 text-[9px] rounded border ${colorMap[color]}`}>
      {children}
    </span>
  );
}
