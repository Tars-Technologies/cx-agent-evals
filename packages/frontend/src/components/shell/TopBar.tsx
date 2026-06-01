"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

const SECTIONS = [
  { href: "/kb", label: "Knowledge Base", match: /^\/kb(\/|$)/ },
  { href: "/agents", label: "Agents", match: /^\/agents(\/|$)/ },
  { href: "/conversations", label: "Conversations", match: /^\/conversations(\/|$)/ },
  { href: "/analytics", label: "Analytics", match: /^\/analytics(\/|$)/ },
] as const;

export function TopBar() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="border-b border-border bg-bg-elevated/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
        <Link href="/kb" className="flex items-center gap-3 hover:opacity-80 transition-opacity shrink-0">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
          <h1 className="text-sm font-semibold tracking-wide text-text">CX Agent Evals</h1>
        </Link>

        <nav className="flex items-center gap-1 bg-bg rounded-md p-0.5">
          {SECTIONS.map((s) => {
            const active = s.match.test(pathname);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  active
                    ? "bg-bg-elevated text-accent"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <OrganizationSwitcher
            appearance={{
              elements: {
                rootBox: "text-sm",
                organizationSwitcherTrigger: "text-text-muted hover:text-text",
              },
            }}
          />
          <UserButton appearance={{ elements: { avatarBox: "w-7 h-7" } }} />
        </div>
      </div>
    </header>
  );
}
