"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { Breadcrumbs, BreadcrumbItem } from "./Breadcrumbs";

export interface SidebarItem {
  label: string;
  href: string;
  icon?: ReactNode;
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
  /** When true, content stretches edge-to-edge; otherwise constrained to max-w-7xl. */
  fullWidth?: boolean;
  /** When true, skips the app TopBar and outer chrome — for use inside another EntityDetailLayout. */
  embedded?: boolean;
  children: ReactNode;
}

function isActive(pathname: string, item: SidebarItem): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function ExpandedItem({
  item,
  pathname,
  depth = 0,
}: {
  item: SidebarItem;
  pathname: string;
  depth?: number;
}) {
  const active = isActive(pathname, item);
  return (
    <>
      <Link
        href={item.href}
        className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors ${
          active
            ? "bg-bg-surface text-accent"
            : "text-text-muted hover:text-text hover:bg-bg-elevated"
        }`}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        <span className="truncate">{item.label}</span>
      </Link>
      {item.children?.map((child) => (
        <ExpandedItem
          key={child.href}
          item={child}
          pathname={pathname}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

/** Flatten the tree, dropping label-only group nodes (those with children + no icon). */
function flattenForCollapsed(items: SidebarItem[]): SidebarItem[] {
  const out: SidebarItem[] = [];
  for (const item of items) {
    if (item.icon) out.push(item);
    if (item.children) out.push(...flattenForCollapsed(item.children));
  }
  return out;
}

function CollapsedItem({
  item,
  pathname,
}: {
  item: SidebarItem;
  pathname: string;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      title={item.label}
      className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
        active
          ? "bg-bg-surface text-accent"
          : "text-text-muted hover:text-text hover:bg-bg-elevated"
      }`}
    >
      {item.icon ?? <span className="text-[10px]">{item.label.charAt(0)}</span>}
    </Link>
  );
}

const COLLAPSED_KEY = "shell:sidebar-collapsed";

export function EntityDetailLayout({
  sidebarTitle,
  sidebar,
  breadcrumbs,
  breadcrumbLabelOverrides,
  fullWidth = false,
  embedded = false,
  children,
}: EntityDetailLayoutProps) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSED_KEY);
      if (v === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const containerClass = fullWidth
    ? "flex-1 w-full px-3 py-3 flex gap-3 min-h-0"
    : "flex-1 max-w-7xl w-full mx-auto px-4 py-4 flex gap-4 min-h-0";

  const collapsedItems = collapsed ? flattenForCollapsed(sidebar) : [];

  const inner = (
    <div className={containerClass}>
        <aside
          className={`shrink-0 hidden md:flex flex-col ${
            collapsed ? "w-10" : "w-40"
          } transition-[width] duration-150`}
        >
          <div className="flex items-center justify-between mb-2 px-0.5">
            {!collapsed && sidebarTitle && (
              <div className="px-1 text-[10px] uppercase tracking-wider text-text-dim truncate">
                {sidebarTitle}
              </div>
            )}
            <button
              onClick={toggle}
              className="ml-auto w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-bg-elevated transition-colors shrink-0"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"}
                />
              </svg>
            </button>
          </div>
          {collapsed ? (
            <nav className="flex flex-col items-center gap-1">
              {collapsedItems.map((item) => (
                <CollapsedItem key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          ) : (
            <nav className="flex flex-col gap-0.5">
              {sidebar.map((item) => (
                <ExpandedItem key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          )}
        </aside>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="mb-3 shrink-0">
            <Breadcrumbs items={breadcrumbs} labelOverrides={breadcrumbLabelOverrides} />
          </div>
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">{children}</div>
        </main>
      </div>
  );

  if (embedded) return inner;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      {inner}
    </div>
  );
}
