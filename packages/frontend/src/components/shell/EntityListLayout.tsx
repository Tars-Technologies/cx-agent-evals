import { ReactNode } from "react";
import { TopBar } from "./TopBar";

interface EntityListLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}

export function EntityListLayout({
  title,
  subtitle,
  actions,
  filters,
  children,
}: EntityListLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">{title}</h2>
            {subtitle && (
              <p className="text-xs text-text-muted mt-1">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {filters && <div className="mb-4">{filters}</div>}
        {children}
      </main>
    </div>
  );
}
