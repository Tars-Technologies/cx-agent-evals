"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Id } from "@convex/_generated/dataModel";

/**
 * Reads ?kb=<kbId> from the URL and syncs it with local state.
 * Returns [selectedKbId, setSelectedKbId] — setting updates the URL.
 */
export function useKbFromUrl(): [
  Id<"knowledgeBases"> | null,
  (kbId: Id<"knowledgeBases"> | null) => void,
] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const kbFromUrl = searchParams.get("kb") as Id<"knowledgeBases"> | null;
  const [selectedKbId, setSelectedKbIdLocal] = useState<Id<"knowledgeBases"> | null>(kbFromUrl);

  // Sync from URL on mount / param change
  useEffect(() => {
    setSelectedKbIdLocal(kbFromUrl);
  }, [kbFromUrl]);

  const setSelectedKbId = useCallback(
    (kbId: Id<"knowledgeBases"> | null) => {
      setSelectedKbIdLocal(kbId);
      const params = new URLSearchParams(searchParams.toString());
      if (kbId) {
        params.set("kb", kbId);
      } else {
        params.delete("kb");
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return [selectedKbId, setSelectedKbId];
}

/**
 * Build a path with the current KB param preserved.
 */
export function buildKbLink(path: string, kbId: Id<"knowledgeBases"> | null): string {
  if (!kbId) return path;
  return `${path}?kb=${kbId}`;
}
