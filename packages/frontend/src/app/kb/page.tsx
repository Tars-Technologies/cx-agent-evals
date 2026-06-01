"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { EntityListLayout } from "@/components/shell/EntityListLayout";
import { Spinner } from "@/components/shell/Spinner";
import { CreateKBModal } from "@/components/CreateKBModal";

export default function KBLandingPage() {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const kbs = useQuery(api.crud.knowledgeBases.listWithDocCounts, {});

  function handleCreated(kbId: Id<"knowledgeBases">) {
    setShowCreate(false);
    router.push(`/kb/${kbId}/configure`);
  }

  return (
    <EntityListLayout
      title="Knowledge Base"
      subtitle="Pick a knowledge base to configure documents and run evaluations."
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          + New KB
        </button>
      }
    >
      {kbs === undefined ? (
        <Spinner label="Loading…" />
      ) : kbs.length === 0 ? (
        <div className="text-text-dim text-xs">
          No knowledge bases yet. Click <span className="text-accent">+ New KB</span> to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {kbs.map((kb) => (
            <Link
              key={kb._id}
              href={`/kb/${kb._id}/configure`}
              className="block border border-border rounded-lg p-4 bg-bg-elevated hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-medium text-text truncate">{kb.name}</h3>
                <span className="text-[10px] text-text-dim shrink-0 mt-0.5">
                  {kb.documentCount} {kb.documentCount === 1 ? "doc" : "docs"}
                </span>
              </div>
              <div className="text-[10px] text-text-dim">
                Updated {new Date(kb._creationTime).toLocaleDateString()}
              </div>
              <div className="mt-3 text-[11px] text-accent">Open →</div>
            </Link>
          ))}
        </div>
      )}

      <CreateKBModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />
    </EntityListLayout>
  );
}
