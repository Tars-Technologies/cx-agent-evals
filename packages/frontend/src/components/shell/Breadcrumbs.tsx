"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  /** Optional override. If omitted, derived from pathname. */
  items?: BreadcrumbItem[];
  /** Label overrides keyed by raw path segment (useful for dynamic IDs). */
  labelOverrides?: Record<string, string>;
}

const SECTION_LABELS: Record<string, string> = {
  kb: "Knowledge Base",
  agents: "Agents",
  conversations: "Conversations",
  analytics: "Analytics",
  configure: "Configure",
  evaluate: "Evaluate",
  datasets: "Datasets",
  retrievers: "Retrievers",
  experiments: "Experiments",
  scenarios: "Scenarios",
  "open-coding": "Open coding",
  "axial-coding": "Axial coding",
  evaluators: "Evaluators",
  transcripts: "Transcripts",
};

function titleize(seg: string): string {
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs({ items, labelOverrides }: BreadcrumbsProps) {
  const pathname = usePathname() ?? "/";
  const derived: BreadcrumbItem[] =
    items ??
    pathname
      .split("/")
      .filter(Boolean)
      .map((seg, i, arr) => {
        const href = "/" + arr.slice(0, i + 1).join("/");
        const label =
          labelOverrides?.[seg] ?? SECTION_LABELS[seg] ?? titleize(seg);
        return { label, href };
      });

  if (derived.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs text-text-muted">
      {derived.map((item, i) => {
        const isLast = i === derived.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {item.href && !isLast ? (
              <Link href={item.href} className="hover:text-text transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-text" : ""}>{item.label}</span>
            )}
            {!isLast && <span className="text-text-dim">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
