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
    const timestamp = req.headers.get("X-Tarser-Timestamp") ?? ""
    const nonce = req.headers.get("X-Tarser-Nonce") ?? ""

    // Reject oversized callbacks by declared length before buffering; the
    // post-read check is a sanity cap for chunked/length-absent requests.
    const MAX_BODY_BYTES = 5_000_000
    const declaredLen = Number(req.headers.get("Content-Length") ?? "")
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 })
    }

    // Raw bytes only: the action hashes/verifies and JSON-parses the body.
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 })
    }

    const { status } = await ctx.runAction(
      internal.kb.tarser_callback.handleTarserCallback,
      { token, jobId, signature, timestamp, nonce, rawBody }
    )
    return new Response(status === 200 ? "ok" : "error", { status })
  })
})

export default http
