"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { dark } from "@clerk/themes"
import { ConvexReactClient } from "convex/react"
import { ConvexProviderWithClerk } from "convex/react-clerk"
import type { ReactNode } from "react"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

export default function ConvexClientProvider({
  children
}: {
  children: ReactNode
}) {
  // If Convex or Clerk aren't configured, render children without providers
  if (!convex || !clerkKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-lg font-semibold">Setup Required</h2>
          <div className="text-sm text-text-muted space-y-2">
            {!convexUrl && (
              <p>
                Set <code className="text-accent">NEXT_PUBLIC_CONVEX_URL</code>{" "}
                in .env
              </p>
            )}
            {!clerkKey && (
              <p>
                Set{" "}
                <code className="text-accent">
                  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
                </code>{" "}
                in .env
              </p>
            )}
          </div>
          <p className="text-xs text-text-dim">
            Run <code>npx convex dev</code> in packages/backend/ to get the
            Convex URL. Get Clerk keys from dashboard.clerk.com.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ClerkProvider
      publishableKey={clerkKey}
      appearance={{
        baseTheme: dark,
        variables: {
          colorBackground: "#141419",
          colorInputBackground: "#1a1a22",
          colorPrimary: "#6ee7b7",
          colorText: "#e8e8ed",
          colorTextSecondary: "#8888a0",
          colorTextOnPrimaryBackground: "#0c0c0f",
          colorInputText: "#e8e8ed",
          colorNeutral: "#8888a0"
        }
      }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}
