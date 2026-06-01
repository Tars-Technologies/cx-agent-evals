import { TopBar } from "@/components/shell/TopBar";

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="text-[10px] uppercase tracking-wider text-text-dim mb-2">
            Analytics &amp; Insights
          </div>
          <h2 className="text-xl font-semibold text-text mb-3">Coming soon</h2>
          <p className="text-xs text-text-muted">
            Cross-section analytics and insights will live here.
          </p>
        </div>
      </main>
    </div>
  );
}
