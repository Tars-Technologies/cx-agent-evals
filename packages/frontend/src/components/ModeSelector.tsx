"use client";

import Link from "next/link";
import { Header } from "@/components/Header";

export function ModeSelector() {
  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <Header />
      <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-accent animate-pulse-dot" />
            <h1 className="text-2xl font-semibold tracking-wide text-text">
              CX Agent Evals
            </h1>
          </div>
          <p className="text-text-muted text-sm">
            RAG Retrieval Evaluation System
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Generate Questions Card */}
          <Link
            href="/generate"
            className="group block border border-border rounded-lg bg-bg-elevated p-8 hover:border-accent/50 hover:bg-bg-elevated/80 transition-all duration-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <svg
                  className="w-5 h-5 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-text group-hover:text-accent transition-colors">
                Generate Questions
              </h2>
            </div>
            <p className="text-text-muted text-sm leading-relaxed">
              Create synthetic evaluation datasets with ground truth spans for
              RAG retrieval testing
            </p>
            <div className="mt-6 text-xs text-text-dim flex items-center gap-2">
              <span>Load corpus</span>
              <span className="text-border">→</span>
              <span>Configure strategy</span>
              <span className="text-border">→</span>
              <span>Generate & upload</span>
            </div>
          </Link>

          {/* Retrievers Card */}
          <Link
            href="/retrievers"
            className="group block border border-border rounded-lg bg-bg-elevated p-8 hover:border-accent/50 hover:bg-bg-elevated/80 transition-all duration-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <svg
                  className="w-5 h-5 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-text group-hover:text-accent transition-colors">
                Retrievers
              </h2>
            </div>
            <p className="text-text-muted text-sm leading-relaxed">
              Configure, index, and test retrieval pipelines against your
              knowledge bases
            </p>
            <div className="mt-6 text-xs text-text-dim flex items-center gap-2">
              <span>Select KB</span>
              <span className="text-border">→</span>
              <span>Configure & index</span>
              <span className="text-border">→</span>
              <span>Test & compare</span>
            </div>
          </Link>

          {/* Run Experiments Card */}
          <Link
            href="/experiments"
            className="group block border border-border rounded-lg bg-bg-elevated p-8 hover:border-accent/50 hover:bg-bg-elevated/80 transition-all duration-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <svg
                  className="w-5 h-5 text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-text group-hover:text-accent transition-colors">
                Run Experiments
              </h2>
            </div>
            <p className="text-text-muted text-sm leading-relaxed">
              Run retrieval experiments on LangSmith datasets and compare
              results across configurations
            </p>
            <div className="mt-6 text-xs text-text-dim flex items-center gap-2">
              <span>Select retriever</span>
              <span className="text-border">→</span>
              <span>Select dataset</span>
              <span className="text-border">→</span>
              <span>Run & analyze</span>
            </div>
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}
