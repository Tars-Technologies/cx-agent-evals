import type { UserIdentity } from "convex/server"
import {
  customAction,
  customMutation,
  customQuery
} from "convex-helpers/server/customFunctions"

import { action, mutation, query } from "../../_generated/server"

type ClerkIdentity = UserIdentity & {
  org_id?: string
  org_role?: string
  org_permissions?: string[]
}

/**
 * Tenant context injected into every tenant-scoped function.
 *
 * Derived server-side from the Clerk JWT identity — never accepted as
 * function arguments.
 */
export type TenantCtx = {
  orgId: string
  userId: string
  orgRole: string
  orgPermissions: string[]
}

/**
 * Middleware that extracts tenant context from the authenticated identity.
 *
 * Throws if the request is unauthenticated or has no active organization.
 * Reads org claims from the Clerk JWT custom claims (`org_id`, `org_role`,
 * `org_permissions`).
 */
export async function withTenantCtx(ctx: {
  auth: { getUserIdentity: () => Promise<ClerkIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new Error("Unauthenticated: no valid session")
  }

  const orgId = identity.org_id
  if (!orgId) {
    throw new Error(
      "No active organization selected. Please select an organization to continue."
    )
  }

  const orgRole = identity.org_role ?? "org:member"
  const orgPermissions = identity.org_permissions ?? []
  const userId = identity.subject

  return {
    ctx: { orgId, userId, orgRole, orgPermissions },
    args: {}
  }
}

export const tenantQuery = customQuery(query, {
  args: {},
  input: withTenantCtx
})

export const tenantMutation = customMutation(mutation, {
  args: {},
  input: withTenantCtx
})

export const tenantAction = customAction(action, {
  args: {},
  input: withTenantCtx
})
