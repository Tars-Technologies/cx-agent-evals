"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

type Scenario = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.scenarios.bySet>>
>[number];

const COMPLEXITY_FILTERS = ["All", "Low", "Medium", "High"] as const;
type ComplexityFilter = (typeof COMPLEXITY_FILTERS)[number];

type ChipColor = "blue" | "green" | "yellow" | "red" | "purple" | "neutral";

function Chip({
  color,
  children,
}: {
  color: ChipColor;
  children: React.ReactNode;
}) {
  const styles: Record<ChipColor, string> = {
    blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    green: "bg-green-500/15 text-green-300 border-green-500/30",
    yellow: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    red: "bg-red-500/15 text-red-300 border-red-500/30",
    purple: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    neutral: "bg-bg-surface text-text-dim border-border",
  };
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] rounded border ${styles[color]}`}
    >
      {children}
    </span>
  );
}

function complexityColor(c: string): "green" | "yellow" | "red" {
  if (c === "low") return "green";
  if (c === "high") return "red";
  return "yellow";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ScenarioListItem({
  scenario,
  selected,
  onClick,
}: {
  scenario: Scenario;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer px-4 py-3 border-b border-border ${
        selected
          ? "bg-bg-elevated border-l-2 border-l-accent"
          : "hover:bg-bg-elevated/50 border-l-2 border-l-transparent"
      }`}
    >
      <h3 className="text-xs text-text font-medium mb-1 truncate">
        {scenario.topic}
      </h3>
      <p className="text-[10px] text-text-dim mb-2 line-clamp-1">
        {scenario.instruction || scenario.reasonForContact}
      </p>
      <div className="flex flex-wrap gap-1">
        <Chip color="blue">{scenario.persona.type}</Chip>
        <Chip color={complexityColor(scenario.complexity)}>
          {scenario.complexity}
        </Chip>
        <Chip color="purple">{scenario.persona.communicationStyle}</Chip>
        <Chip color="purple">{scenario.source.kind}</Chip>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-2">
        {label}
      </h4>
      {children}
    </div>
  );
}

function InfoCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="bg-bg-elevated border border-border rounded p-3">
      <p className="text-[10px] uppercase tracking-wider text-text font-medium mb-1.5">
        {label}
      </p>
      <p className="text-xs text-text-dim leading-relaxed">{text}</p>
    </div>
  );
}

function ScenarioDetail({ scenario }: { scenario: Scenario }) {
  return (
    <div className="p-6 overflow-y-auto h-full">
      <h2 className="text-base text-text font-medium mb-1">{scenario.topic}</h2>
      <p className="text-xs text-text-dim mb-6">{scenario.instruction}</p>

      <Section label="Persona">
        <div className="flex flex-wrap gap-1.5">
          <Chip color="blue">{scenario.persona.type}</Chip>
          <Chip color="purple">{scenario.persona.communicationStyle}</Chip>
          <Chip color="yellow">
            {scenario.persona.patienceLevel} patience
          </Chip>
          {scenario.persona.traits.map((t) => (
            <Chip key={t} color="neutral">
              {t}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="Source">
        <Chip color="purple">{capitalize(scenario.source.kind)}</Chip>
      </Section>

      <Section label="Scenario">
        <Chip color={complexityColor(scenario.complexity)}>
          {scenario.complexity} complexity
        </Chip>
      </Section>

      <div className="mb-6">
        <p className="text-xs text-text">
          <span className="font-medium">Reason for contact:</span>{" "}
          <span className="text-text-dim">{scenario.reasonForContact}</span>
        </p>
      </div>

      <Section label="Information boundaries">
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="Known info" text={scenario.knownInfo} />
          <InfoCard label="Unknown info" text={scenario.unknownInfo} />
        </div>
      </Section>

      {scenario.behaviorAnchors && scenario.behaviorAnchors.length > 0 && (
        <Section label="How this user speaks">
          <ul className="space-y-1.5">
            {scenario.behaviorAnchors.map((a, i) => (
              <li key={i} className="text-xs text-text-dim flex gap-2">
                <span className="text-accent">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export default function SetDetailPage() {
  const params = useParams<{ id: string; setId: string }>();
  const agentId = params.id as Id<"agents">;
  const setId = params.setId as Id<"scenarioSets">;
  const router = useRouter();

  const set = useQuery(api.conversationSim.scenarioSets.get, { id: setId });
  const scenarios = useQuery(api.conversationSim.scenarios.bySet, {
    scenarioSetId: setId,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ComplexityFilter>("All");
  const [selectedId, setSelectedId] =
    useState<Id<"conversationScenarios"> | null>(null);

  const filtered = useMemo(() => {
    if (!scenarios) return [];
    return scenarios.filter((s) => {
      if (filter !== "All" && s.complexity !== filter.toLowerCase())
        return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !s.topic.toLowerCase().includes(q) &&
          !s.instruction.toLowerCase().includes(q) &&
          !s.reasonForContact.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [scenarios, filter, search]);

  const selected =
    filtered.find((s) => s._id === selectedId) ?? filtered[0] ?? null;

  if (set === null) {
    return <div className="p-6 text-sm text-text-dim">Set not found.</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push(`/agents/${agentId}/evaluate/scenarios`)}
            className="text-[10px] text-text-dim hover:text-accent mb-1"
          >
            ← Back to scenario sets
          </button>
          <h1 className="text-sm font-medium text-text">
            {set?.name ?? "Loading…"}
          </h1>
        </div>
        {set && (
          <div className="text-[10px] text-text-dim flex items-center gap-3">
            <span className="uppercase tracking-wider text-accent">
              {set.source}
            </span>
            <span>{set.scenarioCount} scenarios</span>
            <span>
              Created{" "}
              {new Date(set.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-[360px_1fr] min-h-0">
        <div className="border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-text-dim">
              Scenarios
            </span>
            <span className="text-[10px] text-text-dim">
              {scenarios?.length ?? 0} total
            </span>
          </div>
          <div className="px-4 py-3 space-y-2 border-b border-border shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search scenarios..."
              className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none placeholder:text-text-dim"
            />
            <div className="flex gap-1">
              {COMPLEXITY_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-0.5 text-[10px] rounded transition-colors ${
                    filter === f
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "text-text-dim hover:text-text border border-transparent"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {scenarios === undefined ? (
              <div className="p-4 text-xs text-text-dim">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-xs text-text-dim">
                No scenarios match.
              </div>
            ) : (
              filtered.map((s) => (
                <ScenarioListItem
                  key={s._id}
                  scenario={s}
                  selected={s._id === selected?._id}
                  onClick={() => setSelectedId(s._id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-hidden">
          {selected ? (
            <ScenarioDetail scenario={selected} />
          ) : (
            <div className="p-6 text-xs text-text-dim">
              Select a scenario from the list.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
