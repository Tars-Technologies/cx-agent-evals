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

      {/* Instruction */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Instruction</h3>
        <div className="bg-bg border border-border rounded-md p-3">
          <pre className="text-xs text-text leading-relaxed whitespace-pre-wrap font-mono">
            {scenario.instruction}
          </pre>
        </div>
      </section>

      {/* Reference Messages */}
      {scenario.referenceMessages && scenario.referenceMessages.length > 0 && (
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
      )}
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
