"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BreadcrumbItem } from "./Breadcrumbs";

export interface TabItem {
  label: string;
  value: string;
}

interface TabsLayoutProps {
  title: string;
  tabs: TabItem[];
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
  paramName?: string;
}

export function TabsLayout({
  title,
  tabs,
  breadcrumbs,
  children,
  paramName = "tab",
}: TabsLayoutProps) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const defaultValue = tabs[0]?.value;
  const current = searchParams?.get(paramName) ?? defaultValue;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 min-h-0 max-w-7xl w-full mx-auto px-6 py-4 flex flex-col">
        <div className="border-b border-border flex gap-1 mb-4 flex-shrink-0">
          {tabs.map((t) => {
            const active = current === t.value;
            const href =
              t.value === defaultValue
                ? pathname
                : `${pathname}?${paramName}=${t.value}`;
            return (
              <Link
                key={t.value}
                href={href}
                className={`px-4 py-2 text-xs transition-colors border-b-2 -mb-px ${
                  active
                    ? "border-accent text-accent"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </main>
    </div>
  );
}
