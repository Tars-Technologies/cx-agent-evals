"use client";

import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

interface HeaderProps {
  mode?: "generate" | "experiments" | "agent";
  onReset?: () => void;
}

export function Header({ mode, onReset }: HeaderProps) {
  return (
    <header className="border-b border-border bg-bg-elevated/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
            <h1 className="text-sm font-semibold tracking-wide text-text">
              rag-eval
            </h1>
          </Link>
          {mode && (
            <>
              <span className="text-text-dim text-xs">/</span>
              <div className="flex gap-1 bg-bg rounded-md p-0.5">
                <Link
                  href="/generate"
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "generate"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Generate
                </Link>
                <Link
                  href="/experiments"
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "experiments"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Experiments
                </Link>
                <Link
                  href="/agent"
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "agent"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Agent
                </Link>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onReset && (
            <button
              onClick={onReset}
              className="text-xs text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              reset
            </button>
          )}
          <OrganizationSwitcher
            appearance={{
              elements: {
                rootBox: "text-sm",
                organizationSwitcherTrigger: "text-text-muted hover:text-text",
              },
            }}
          />
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-7 h-7",
              },
            }}
          />
        </div>
      </div>
    </header>
  );
}
