"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const navItems = [
  {
    key: "annotate",
    label: "Annotate",
    path: "/annotate",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    key: "failure-modes",
    label: "Failure Modes",
    path: "/failure-modes",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
  },
];

export function ExperimentNavSidebar() {
  const params = useParams();
  const pathname = usePathname();
  const basePath = `/experiments/${params.id as string}`;

  return (
    <div className="w-12 bg-bg border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
      {navItems.map((item) => {
        const href = `${basePath}${item.path}`;
        const isActive = pathname.startsWith(href);

        return (
          <Link
            key={item.key}
            href={href}
            className={`group relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              isActive
                ? "text-accent bg-accent/10"
                : "text-text-dim hover:text-text hover:bg-bg-hover"
            }`}
          >
            {item.icon}
            <span className="absolute left-full ml-2 px-2 py-1 rounded bg-bg-elevated border border-border text-xs text-text whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
