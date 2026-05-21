"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { Breadcrumbs, BreadcrumbItem } from "./Breadcrumbs";

export interface SidebarItem {
  label: string;
  href: string;
  /** Nested items shown indented beneath this item. */
  children?: SidebarItem[];
  /** Optional matcher; defaults to startsWith(href). */
  match?: (pathname: string) => boolean;
}

interface EntityDetailLayoutProps {
  sidebarTitle?: string;
  sidebar: SidebarItem[];
  breadcrumbs?: BreadcrumbItem[];
  breadcrumbLabelOverrides?: Record<string, string>;
  children: ReactNode;
}

function isActive(pathname: string, item: SidebarItem): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function SidebarLink({ item, pathname, depth = 0 }: { item: SidebarItem; pathname: string; depth?: number }) {
  const active = isActive(pathname, item);
  return (
    <>
      <Link
        href={item.href}
        className={`block px-3 py-1.5 text-xs rounded transition-colors ${
          active
            ? "bg-bg-surface text-accent"
            : "text-text-muted hover:text-text hover:bg-bg-elevated"
        }`}
        style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
      >
        {item.label}
      </Link>
      {item.children?.map((child) => (
        <SidebarLink key={child.href} item={child} pathname={pathname} depth={depth + 1} />
      ))}
    </>
  );
}

export function EntityDetailLayout({
  sidebarTitle,
  sidebar,
  breadcrumbs,
  breadcrumbLabelOverrides,
  children,
}: EntityDetailLayoutProps) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex gap-6">
        <aside className="w-56 shrink-0 hidden md:block">
          {sidebarTitle && (
            <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-text-dim">
              {sidebarTitle}
            </div>
          )}
          <nav className="flex flex-col gap-0.5">
            {sidebar.map((item) => (
              <SidebarLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <div className="mb-4">
            <Breadcrumbs items={breadcrumbs} labelOverrides={breadcrumbLabelOverrides} />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
