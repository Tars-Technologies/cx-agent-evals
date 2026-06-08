/**
 * HTTP routes. Currently: the Tarser content-service callback.
 *
 * This file runs in the Convex default runtime, so it must NOT import the
 * eval-lib scraper barrel (it statically pulls node-only deps). It reads the
 * request and delegates verification + dispatch to a "use node" action.
 */
import { httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"

const http = httpRouter()

http.route({
  path: "/tarser/cb",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url)
    const token = url.searchParams.get("token") ?? ""
    const jobId = req.headers.get("X-Tarser-Job-Id") ?? ""
    const signature = req.headers.get("X-Tarser-Signature") ?? ""

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return new Response("invalid json", { status: 400 })
    }

    const { status } = await ctx.runAction(
      internal.kb.tarser_callback.handleTarserCallback,
      { token, jobId, signature, body }
    )
    return new Response(status === 200 ? "ok" : "error", { status })
  })
})

export default http
