import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@tars-inc/eval-lib", "openai"]
}

export default nextConfig
