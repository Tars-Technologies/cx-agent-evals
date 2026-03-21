"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

interface AgentConfigPanelProps {
  agentId: Id<"agents">;
}

const sectionHeader = "text-text-muted text-[9px] uppercase tracking-wider mb-1.5";
const container = "bg-bg-elevated border border-border rounded-lg p-3";
const labelCls = "text-text-muted text-[9px]";
const inputCls =
  "w-full bg-bg-surface border border-border rounded-md px-2 py-1.5 text-[10px] text-text focus:border-accent/50 focus:outline-none";
const textareaCls = `${inputCls} min-h-[60px] resize-y`;
const selectCls = inputCls;

export default function AgentConfigPanel({ agentId }: AgentConfigPanelProps) {
  const agent = useQuery(api.crud.agents.get, { id: agentId });
  const updateAgent = useMutation(api.crud.agents.update);
  const triggerExtract = useMutation(
    api.agents.orchestration.triggerUrlExtraction,
  );
  const allRetrievers = useQuery(api.crud.retrievers.byOrg, {}) ?? [];
  const allKbs = useQuery(api.crud.knowledgeBases.list, {}) ?? [];

  // Form state
  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [formality, setFormality] = useState("professional");
  const [length, setLength] = useState("concise");
  const [formatting, setFormatting] = useState("");
  const [language, setLanguage] = useState("English");
  const [outOfScope, setOutOfScope] = useState("");
  const [escalationRules, setEscalationRules] = useState("");
  const [compliance, setCompliance] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [enableReflection, setEnableReflection] = useState(false);
  const [retrieverIds, setRetrieverIds] = useState<Id<"retrievers">[]>([]);
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  const [guardrailsOpen, setGuardrailsOpen] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const [showRetrieverPicker, setShowRetrieverPicker] = useState(false);

  // Sync form state from query data
  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setAgentName(agent.identity.agentName);
    setCompanyName(agent.identity.companyName);
    setCompanyUrl(agent.identity.companyUrl ?? "");
    setRoleDescription(agent.identity.roleDescription);
    setBrandVoice(agent.identity.brandVoice ?? "");
    setFormality(agent.responseStyle.formality ?? "professional");
    setLength(agent.responseStyle.length ?? "concise");
    setFormatting(agent.responseStyle.formatting ?? "");
    setLanguage(agent.responseStyle.language ?? "English");
    setOutOfScope(agent.guardrails.outOfScope ?? "");
    setEscalationRules(agent.guardrails.escalationRules ?? "");
    setCompliance(agent.guardrails.compliance ?? "");
    setModel(agent.model);
    setEnableReflection(agent.enableReflection);
    setRetrieverIds(agent.retrieverIds);
    setAdditionalInstructions(agent.additionalInstructions ?? "");
  }, [agent]);

  const handleSave = async () => {
    await updateAgent({
      id: agentId,
      name,
      identity: {
        agentName,
        companyName,
        companyUrl: companyUrl || undefined,
        companyContext: agent?.identity.companyContext,
        roleDescription,
        brandVoice: brandVoice || undefined,
      },
      responseStyle: {
        formality: formality || undefined,
        length: length || undefined,
        formatting: formatting || undefined,
        language: language || undefined,
      },
      guardrails: {
        outOfScope: outOfScope || undefined,
        escalationRules: escalationRules || undefined,
        compliance: compliance || undefined,
      },
      model,
      enableReflection,
      retrieverIds,
      additionalInstructions: additionalInstructions || undefined,
    });
  };

  const handleExtract = async () => {
    if (!companyUrl) return;
    await triggerExtract({ agentId, url: companyUrl });
  };

  // Group retrievers by KB for the picker
  const kbMap = new Map(allKbs.map((kb) => [kb._id, kb.name]));
  const retrieversByKb = new Map<string, typeof allRetrievers>();
  for (const r of allRetrievers) {
    const kbName = kbMap.get(r.kbId) ?? "Unknown";
    if (!retrieversByKb.has(kbName)) retrieversByKb.set(kbName, []);
    retrieversByKb.get(kbName)!.push(r);
  }

  // Linked retrievers for display
  const linkedRetrievers = allRetrievers.filter((r) =>
    retrieverIds.includes(r._id),
  );

  if (!agent)
    return <div className="p-4 text-text-dim text-sm">Loading...</div>;

  return (
    <div className="p-3.5 space-y-3.5 overflow-y-auto">
      {/* ── Section 1: Agent Name ── */}
      <div>
        <div className={sectionHeader}>Agent Name</div>
        <div className={container}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Support Agent"
            className={inputCls}
          />
        </div>
      </div>

      {/* ── Section 2: Identity & Company ── */}
      <div>
        <div className={sectionHeader}>Identity &amp; Company</div>
        <div className={`${container} space-y-2.5`}>
          <div>
            <label className={labelCls}>Agent Display Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Ava"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Inc."
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Role Description</label>
            <textarea
              value={roleDescription}
              onChange={(e) => setRoleDescription(e.target.value)}
              placeholder="Describe what this agent does..."
              className={textareaCls}
            />
          </div>

          <div>
            <label className={labelCls}>Company URL</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={companyUrl}
                onChange={(e) => setCompanyUrl(e.target.value)}
                placeholder="https://example.com"
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={handleExtract}
                disabled={!companyUrl}
                className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors ${
                  companyUrl
                    ? "bg-accent text-bg hover:bg-accent/90 cursor-pointer"
                    : "bg-border text-text-dim cursor-not-allowed"
                }`}
              >
                Extract
              </button>
            </div>
          </div>

          {agent.identity.companyContext && (
            <div>
              <label className={labelCls}>Extracted Company Context</label>
              <div className="bg-bg-surface border border-border rounded-md px-2 py-1.5 text-[10px] text-text-muted whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {agent.identity.companyContext}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Brand Voice</label>
            <textarea
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              placeholder="Describe the brand voice and tone..."
              className={textareaCls}
            />
          </div>
        </div>
      </div>

      {/* ── Section 3: Response Style ── */}
      <div>
        <div className={sectionHeader}>Response Style</div>
        <div className={`${container} space-y-2.5`}>
          <div>
            <label className={labelCls}>Formality</label>
            <select
              value={formality}
              onChange={(e) => setFormality(e.target.value)}
              className={selectCls}
            >
              <option value="casual">Casual</option>
              <option value="professional">Professional</option>
              <option value="formal">Formal</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Length</label>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value)}
              className={selectCls}
            >
              <option value="concise">Concise</option>
              <option value="detailed">Detailed</option>
              <option value="comprehensive">Comprehensive</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Formatting</label>
            <input
              type="text"
              value={formatting}
              onChange={(e) => setFormatting(e.target.value)}
              placeholder="e.g. Use bullet points, keep paragraphs short"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Language</label>
            <input
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="e.g. English"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* ── Section 4: Guardrails (collapsible) ── */}
      <div>
        <button
          onClick={() => setGuardrailsOpen(!guardrailsOpen)}
          className={`${sectionHeader} flex items-center gap-1 cursor-pointer hover:text-text transition-colors w-full text-left`}
        >
          <span className="text-[9px]">{guardrailsOpen ? "\u25BE" : "\u25B8"}</span>
          Guardrails
        </button>
        {guardrailsOpen && (
          <div className={`${container} space-y-2.5`}>
            <div>
              <label className={labelCls}>Out of Scope</label>
              <textarea
                value={outOfScope}
                onChange={(e) => setOutOfScope(e.target.value)}
                placeholder="Topics the agent should not address..."
                className={textareaCls}
              />
            </div>

            <div>
              <label className={labelCls}>Escalation Rules</label>
              <textarea
                value={escalationRules}
                onChange={(e) => setEscalationRules(e.target.value)}
                placeholder="When to escalate to a human agent..."
                className={textareaCls}
              />
            </div>

            <div>
              <label className={labelCls}>Compliance</label>
              <textarea
                value={compliance}
                onChange={(e) => setCompliance(e.target.value)}
                placeholder="Compliance requirements and restrictions..."
                className={textareaCls}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Agent Behavior ── */}
      <div>
        <div className={sectionHeader}>Agent Behavior</div>
        <div className={`${container} space-y-2.5`}>
          <div>
            <label className={labelCls}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={selectCls}
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-haiku-4-20250514">Claude Haiku 4</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enableReflection}
              onChange={(e) => setEnableReflection(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-[10px] text-text">Enable Reflection</span>
          </label>
        </div>
      </div>

      {/* ── Section 6: Retriever Tools ── */}
      <div>
        <div className={sectionHeader}>Retriever Tools</div>
        <div className={`${container} space-y-2`}>
          {linkedRetrievers.length === 0 && (
            <p className="text-text-dim text-[10px]">
              No retrievers linked yet.
            </p>
          )}

          {linkedRetrievers.map((r) => (
            <div
              key={r._id}
              className="flex items-center justify-between bg-bg-surface rounded-md px-2 py-1.5"
            >
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-text truncate block">
                  {r.name}
                </span>
                <span className="text-[8px] text-text-dim">
                  {kbMap.get(r.kbId) ?? "Unknown KB"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[8px] px-1.5 py-px rounded-full ${
                    r.status === "ready"
                      ? "bg-accent/10 text-accent"
                      : r.status === "error"
                        ? "bg-red-500/10 text-red-400"
                        : r.status === "indexing"
                          ? "bg-yellow-500/10 text-yellow-400"
                          : "bg-bg-elevated text-text-dim"
                  }`}
                >
                  {r.status}
                </span>
                <button
                  onClick={() =>
                    setRetrieverIds((ids) =>
                      ids.filter((id) => id !== r._id),
                    )
                  }
                  className="text-text-dim hover:text-red-400 text-[10px] transition-colors cursor-pointer"
                >
                  x
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setShowRetrieverPicker(!showRetrieverPicker)}
            className="text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer"
          >
            + Add retriever
          </button>

          {showRetrieverPicker && (
            <div className="border border-border rounded-md bg-bg-surface p-2 space-y-2 max-h-[200px] overflow-y-auto">
              {Array.from(retrieversByKb.entries()).map(
                ([kbName, retrievers]) => (
                  <div key={kbName}>
                    <div className="text-[8px] text-text-dim uppercase tracking-wider mb-1">
                      {kbName}
                    </div>
                    {retrievers.map((r) => {
                      const alreadyLinked = retrieverIds.includes(r._id);
                      const isReady = r.status === "ready";
                      const clickable = isReady && !alreadyLinked;

                      return (
                        <button
                          key={r._id}
                          onClick={() => {
                            if (!clickable) return;
                            setRetrieverIds((ids) => [...ids, r._id]);
                            setShowRetrieverPicker(false);
                          }}
                          disabled={!clickable}
                          className={`w-full text-left px-2 py-1 rounded text-[10px] flex items-center justify-between transition-colors ${
                            clickable
                              ? "hover:bg-bg-hover cursor-pointer text-text"
                              : "text-text-dim cursor-not-allowed opacity-50"
                          }`}
                        >
                          <span className="truncate">{r.name}</span>
                          <span
                            className={`text-[8px] px-1.5 py-px rounded-full ml-2 flex-shrink-0 ${
                              r.status === "ready"
                                ? "bg-accent/10 text-accent"
                                : r.status === "error"
                                  ? "bg-red-500/10 text-red-400"
                                  : r.status === "indexing"
                                    ? "bg-yellow-500/10 text-yellow-400"
                                    : "bg-bg-elevated text-text-dim"
                            }`}
                          >
                            {alreadyLinked ? "linked" : r.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ),
              )}
              {retrieversByKb.size === 0 && (
                <p className="text-text-dim text-[9px]">
                  No retrievers found in this org.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 7: Additional Instructions (collapsible) ── */}
      <div>
        <button
          onClick={() => setAdditionalOpen(!additionalOpen)}
          className={`${sectionHeader} flex items-center gap-1 cursor-pointer hover:text-text transition-colors w-full text-left`}
        >
          <span className="text-[9px]">{additionalOpen ? "\u25BE" : "\u25B8"}</span>
          Additional Instructions
        </button>
        {additionalOpen && (
          <div className={container}>
            <textarea
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              placeholder="Any extra instructions for the agent..."
              className={textareaCls}
            />
          </div>
        )}
      </div>

      {/* ── Section 8: Save Button ── */}
      <button
        onClick={handleSave}
        className="w-full bg-accent text-bg text-xs py-2 rounded-md font-medium hover:bg-accent/90 transition-colors cursor-pointer"
      >
        Save
      </button>
    </div>
  );
}
