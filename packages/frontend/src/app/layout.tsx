import type { Metadata } from "next"
import { JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { AuthGate } from "@/components/AuthGate"
import ConvexClientProvider from "@/components/ConvexClientProvider"

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"]
})

export const metadata: Metadata = {
  title: "RAG Eval — Synthetic Data Generator",
  description:
    "Generate synthetic evaluation questions for RAG retrieval pipelines"
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${jetbrains.variable} min-h-screen bg-bg text-text antialiased`}
        style={{ fontFamily: "var(--font-jetbrains), ui-monospace, monospace" }}
      >
        <ConvexClientProvider>
          <AuthGate>{children}</AuthGate>
        </ConvexClientProvider>
      </body>
    </html>
  )
}
