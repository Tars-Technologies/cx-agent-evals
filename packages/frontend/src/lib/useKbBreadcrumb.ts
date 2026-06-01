import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

/**
 * Subscribes to a KB by id and returns the doc plus a `labelOverrides`
 * map suitable for passing to <EntityDetailLayout breadcrumbLabelOverrides=...>.
 * Convex deduplicates identical subscriptions, so calling this in every KB
 * sub-page is cheap.
 */
export function useKbBreadcrumb(
  kbId: Id<"knowledgeBases">,
  extra?: Record<string, string>,
) {
  const kb = useQuery(api.crud.knowledgeBases.get, { id: kbId });
  const labelOverrides = kb
    ? { [kbId]: kb.name, ...(extra ?? {}) }
    : extra;
  return { kb, labelOverrides };
}
