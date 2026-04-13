"use client";

import type { LivechatTab } from "./types";

const TABS: { key: LivechatTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "conversations", label: "Conversations" },
];

export function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: LivechatTab;
  onTabChange: (tab: LivechatTab) => void;
}) {
  return (
    <div className="flex border-b border-border bg-bg-elevated">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === tab.key
              ? "border-b-2 border-accent text-accent"
              : "text-text-dim hover:text-text"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
