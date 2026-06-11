import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

/**
 * Subscribes to an agent by id and returns the doc plus a `labelOverrides`
 * map suitable for passing to <EntityDetailLayout breadcrumbLabelOverrides=...>.
 * Convex deduplicates identical subscriptions, so calling this in every agent
 * sub-page is cheap.
 */
export function useAgentBreadcrumb(
  agentId: Id<"agents">,
  extra?: Record<string, string>,
) {
  const agent = useQuery(api.crud.agents.get, { id: agentId });
  const labelOverrides = agent
    ? { [agentId]: agent.name, ...(extra ?? {}) }
    : extra;
  return { agent, labelOverrides };
}
