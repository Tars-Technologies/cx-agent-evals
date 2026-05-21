"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { Breadcrumbs, BreadcrumbItem } from "./Breadcrumbs";

export interface TabItem {
  label: string;
  href: string;
}

interface TabsLayoutProps {
  title: string;
  tabs: TabItem[];
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
}

export function TabsLayout({ title, tabs, breadcrumbs, children }: TabsLayoutProps) {
  const pathname = usePathname() ?? "/";
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <div className="mb-3">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <h2 className="text-lg font-semibold text-text mb-4">{title}</h2>
        <div className="border-b border-border flex gap-1 mb-6">
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
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
        {children}
      </main>
    </div>
  );
}
