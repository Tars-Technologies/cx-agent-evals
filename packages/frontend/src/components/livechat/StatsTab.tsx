"use client";

import type { BasicStats } from "./types";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg-surface rounded-md border border-border p-3">
      <div className="text-text-dim text-[10px] uppercase tracking-wide">
        {label}
      </div>
      <div className="text-accent text-lg font-semibold mt-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function StatsTab({ stats }: { stats: BasicStats | null }) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view stats
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Top row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Total Conversations" value={stats.totalConversations} />
        <StatCard label="With User Messages" value={stats.conversationsWithUserMessages} />
        <StatCard label="Unique Visitors" value={stats.uniqueVisitors} />
        <StatCard label="Unique Agents" value={stats.uniqueAgents} />
      </div>

      {/* Duration row */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Avg Duration" value={formatDuration(stats.durationStats.avgDurationSeconds)} />
        <StatCard label="Median Duration" value={formatDuration(stats.durationStats.medianDurationSeconds)} />
        <StatCard label="Avg Msgs (Visitor)" value={stats.visitorStats.avgMessagesPerConversation} />
        <StatCard label="Avg Msgs (Agent)" value={stats.agentStats.avgMessagesPerConversation} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-bg-surface rounded-md border border-border p-3">
          <div className="text-text-muted text-xs mb-2">Top Agents</div>
          {stats.agentBreakdown.slice(0, 10).map((agent) => (
            <div
              key={agent.agentEmail}
              className="flex justify-between text-xs mb-1"
            >
              <span className="text-text truncate mr-2">{agent.agentName}</span>
              <span className="text-accent">{agent.conversationCount.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="bg-bg-surface rounded-md border border-border p-3">
          <div className="text-text-muted text-xs mb-2">Labels</div>
          {Object.entries(stats.labelBreakdown)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([label, count]) => (
              <div key={label} className="flex justify-between text-xs mb-1">
                <span className="text-text truncate mr-2">{label}</span>
                <span className="text-accent">{count.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
