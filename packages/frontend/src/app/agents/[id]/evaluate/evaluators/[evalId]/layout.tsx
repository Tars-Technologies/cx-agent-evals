"use client";

import { ReactNode } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export default function EvaluatorDetailLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string; evalId: string }>();
  const agentId = params.id;
  const evalId = params.evalId as Id<"evaluators">;
  const evaluator = useQuery(api.evaluator.crud.get, { id: evalId });
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  const base = `/agents/${agentId}/evaluate/evaluators/${evalId}`;

  const tabs = [
    {
      label: "Configure",
      href: base,
      isActive: !pathname.endsWith("/validate") && (tab === null || tab === "configure"),
    },
    {
      label: "Labels",
      href: `${base}?tab=labels`,
      isActive: !pathname.endsWith("/validate") && tab === "labels",
    },
    {
      label: "Validate",
      href: `${base}/validate`,
      isActive: pathname.endsWith("/validate"),
    },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 pt-4 shrink-0">
        <h2 className="text-lg font-semibold text-text mb-3">
          {evaluator === undefined ? (
            <span className="animate-pulse text-text-dim">Loading…</span>
          ) : (
            evaluator.name
          )}
        </h2>
        <div className="border-b border-border flex gap-1 -mb-px">
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className={`px-4 py-2 text-xs transition-colors border-b-2 -mb-px ${
                t.isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">{children}</div>
    </div>
  );
}
