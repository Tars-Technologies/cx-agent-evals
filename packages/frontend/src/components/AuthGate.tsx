"use client";

import { useState, useEffect } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import {
  SignInButton,
  SignUpButton,
  OrganizationList,
  useAuth,
  useOrganization,
  useOrganizationList,
} from "@clerk/nextjs";

function BrandedSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-3">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse-dot" />
          <span className="text-sm font-semibold tracking-wide text-text">
            rag-eval
          </span>
        </div>
        <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <BrandedSpinner />;
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <OrgGate>{children}</OrgGate>;
}

function LandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="max-w-sm w-full text-center space-y-8 p-8 animate-fade-in">
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-3">
            <div className="w-3 h-3 rounded-full bg-accent animate-pulse-dot" />
            <h1 className="text-2xl font-semibold tracking-wide text-text">
              rag-eval
            </h1>
          </div>
          <p className="text-text-muted text-sm">
            Evaluate RAG retrieval pipelines with synthetic datasets
          </p>
        </div>

        <div className="space-y-3">
          <SignInButton mode="modal">
            <button className="w-full px-6 py-3 bg-accent text-bg-elevated rounded-lg hover:bg-accent/90 transition-colors font-semibold text-sm cursor-pointer">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="w-full px-6 py-3 border border-border text-text-muted rounded-lg hover:border-accent/50 hover:text-text transition-colors text-sm cursor-pointer">
              Create Account
            </button>
          </SignUpButton>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex justify-center gap-6 text-xs text-text-dim">
            <span>Question Generation</span>
            <span className="text-border">&middot;</span>
            <span>Retrieval Experiments</span>
            <span className="text-border">&middot;</span>
            <span>LangSmith Sync</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrgGate({ children }: { children: React.ReactNode }) {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { orgId: clerkAuthOrgId } = useAuth();
  const { isLoaded: listLoaded, setActive, userMemberships } =
    useOrganizationList({ userMemberships: { infinite: true } });
  const { isLoading: convexLoading } = useConvexAuth();
  const [activating, setActivating] = useState(false);
  const [userSynced, setUserSynced] = useState(false);
  const getOrCreateUser = useMutation(api.crud.users.getOrCreate);

  // Auto-select first org if user has orgs but none is active
  useEffect(() => {
    if (!orgLoaded || !listLoaded || organization || activating) return;

    const memberships = userMemberships?.data;
    if (memberships && memberships.length > 0 && setActive) {
      setActivating(true);
      setActive({ organization: memberships[0].organization.id }).finally(() =>
        setActivating(false),
      );
    }
  }, [orgLoaded, listLoaded, organization, activating, userMemberships?.data, setActive]);

  // Still loading org state or auto-activating
  if (!orgLoaded || !listLoaded || activating) {
    return <BrandedSpinner />;
  }

  // User truly has no orgs — show setup screen
  if (!organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="max-w-lg w-full text-center space-y-6 p-8 animate-fade-in">
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
              <span className="text-sm font-semibold tracking-wide text-text">
                rag-eval
              </span>
            </div>
            <h2 className="text-lg font-medium text-text">
              Create an Organization
            </h2>
            <p className="text-text-muted text-sm">
              Create an organization to get started.
            </p>
          </div>
          <div className="flex justify-center">
            <OrganizationList hidePersonal={true} />
          </div>
        </div>
      </div>
    );
  }

  // Org is set locally in Clerk, but wait until:
  // 1. Clerk's auth session JWT includes the org_id (clerkAuthOrgId matches)
  // 2. Convex has finished syncing the new token (!convexLoading)
  if (clerkAuthOrgId !== organization.id || convexLoading) {
    return <BrandedSpinner />;
  }

  // Ensure the user has a record in the users table before rendering children.
  // The users:getOrCreate mutation is idempotent — it looks up by clerkId and
  // creates the record only if missing.
  useEffect(() => {
    if (!userSynced) {
      getOrCreateUser().then(() => setUserSynced(true));
    }
  }, [userSynced, getOrCreateUser]);

  if (!userSynced) {
    return <BrandedSpinner />;
  }

  return <>{children}</>;
}
