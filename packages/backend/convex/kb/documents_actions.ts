"use node"

import type { ParsedFile } from "@tars-inc/eval-lib/scraper"
/**
 * Parse an uploaded file into markdown, then create the document.
 * - inprocess: parse synchronously here (InProcessParser.parseFile) and create the doc.
 * - tarser: create a "parsing" placeholder and submit to Tarser; parse_done fills it via http.ts.
 * - asimov: create a "parsing" placeholder and submit to Asimov; pollAsimovParse drains the
 *   result (poll, no callback) and fills it via finishParse.
 */
import { JobNotReadyError, makeParser } from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { backendConfig } from "../config"
import {
  ASIMOV_POLL_DEADLINE_MS,
  ASIMOV_REPOLL_DELAY_MS,
  tarserCallbackUrl
} from "./providers"

export const parseDocument = internalAction({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    storageId: v.id("_storage"),
    title: v.string(),
    mimeType: v.string(),
    backend: v.union(
      v.literal("inprocess"),
      v.literal("tarser"),
      v.literal("asimov")
    ),
    ocr: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    if (args.backend === "asimov") {
      const asimov = backendConfig.asimov
      if (!asimov) throw new Error("Asimov is not configured")
      const fileUrl = await ctx.storage.getUrl(args.storageId)
      if (!fileUrl) throw new Error("Uploaded file not found")
      const parser = makeParser({ backend: "asimov", ...asimov })
      let serviceJobId: string
      try {
        const result = await parser.startParse({
          fileUrl,
          mimeType: args.mimeType,
          // Only send OCR when requested; otherwise let Asimov apply its defaults.
          ...(args.ocr ? { options: { ocr: true } } : {}),
          // Asimov polls — no callback. callbackUrl is required by the port but ignored.
          callbackUrl: ""
        })
        serviceJobId = result.serviceJobId
      } catch (error) {
        await ctx.runMutation(internal.kb.documents.recordParseFailure, {
          orgId: args.orgId,
          kbId: args.kbId,
          title: args.title,
          mimeType: args.mimeType,
          backend: "asimov",
          fileId: args.storageId,
          error:
            error instanceof Error
              ? error.message
              : "Failed to submit document to Asimov"
        })
        return
      }
      await ctx.runMutation(internal.kb.documents.createParsing, {
        orgId: args.orgId,
        kbId: args.kbId,
        title: args.title,
        mimeType: args.mimeType,
        fileId: args.storageId,
        backend: "asimov",
        parseServiceJobId: serviceJobId,
        // No per-job callback token on the poll path; finishParse is keyed by job id.
        parseToken: ""
      })
      await ctx.scheduler.runAfter(
        0,
        internal.kb.documents_actions.pollAsimovParse,
        {
          parseServiceJobId: serviceJobId
        }
      )
      return
    }

    if (args.backend === "tarser") {
      const tarser = backendConfig.tarser
      if (!tarser) throw new Error("Tarser is not configured")
      const fileUrl = await ctx.storage.getUrl(args.storageId)
      if (!fileUrl) throw new Error("Uploaded file not found")
      const parseToken = crypto.randomUUID()
      const parser = makeParser({ backend: "tarser", ...tarser })
      let serviceJobId: string
      try {
        const result = await parser.startParse({
          fileUrl,
          mimeType: args.mimeType,
          // Only send options when OCR is requested; otherwise let Tarser
          // apply its own defaults. OCR has no effect on the inprocess path.
          ...(args.ocr ? { options: { ocr: true } } : {}),
          callbackUrl: tarserCallbackUrl(parseToken)
        })
        serviceJobId = result.serviceJobId
      } catch (error) {
        // Tarser unreachable / rejected the submit: surface a failed upload
        // instead of letting the action vanish with no document.
        await ctx.runMutation(internal.kb.documents.recordParseFailure, {
          orgId: args.orgId,
          kbId: args.kbId,
          title: args.title,
          mimeType: args.mimeType,
          backend: "tarser",
          fileId: args.storageId,
          error:
            error instanceof Error
              ? error.message
              : "Failed to submit document to Tarser"
        })
        return
      }
      await ctx.runMutation(internal.kb.documents.createParsing, {
        orgId: args.orgId,
        kbId: args.kbId,
        title: args.title,
        mimeType: args.mimeType,
        fileId: args.storageId,
        parseServiceJobId: serviceJobId,
        parseToken
      })
      return
    }

    // inprocess: read bytes, parse synchronously, create the doc.
    const blob = await ctx.storage.get(args.storageId)
    if (!blob) throw new Error("Uploaded file not found")
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const parser = makeParser()
    let parsed: ParsedFile
    try {
      parsed = await parser.parseFile(bytes, args.mimeType)
    } catch (error) {
      // Unsupported type / parse error: surface a failed upload, don't vanish.
      await ctx.runMutation(internal.kb.documents.recordParseFailure, {
        orgId: args.orgId,
        kbId: args.kbId,
        title: args.title,
        mimeType: args.mimeType,
        backend: "inprocess",
        fileId: args.storageId,
        error:
          error instanceof Error ? error.message : "Failed to parse document"
      })
      return
    }
    await ctx.runMutation(internal.kb.documents.createParsed, {
      orgId: args.orgId,
      kbId: args.kbId,
      title: parsed.title ?? args.title,
      content: parsed.markdown,
      mimeType: args.mimeType,
      fileId: args.storageId
    })
  }
})

/**
 * Poll an Asimov parse job to completion, then fill the parsing placeholder via
 * finishParse. Self-reschedules while the job is still running (JobNotReadyError),
 * so a long parse spans multiple action budgets without blocking one indefinitely.
 * Asimov is poll-based — there is NO callback route for it (unlike Tarser's /tarser/cb).
 */
export const pollAsimovParse = internalAction({
  args: { parseServiceJobId: v.string() },
  handler: async (ctx, args) => {
    const asimov = backendConfig.asimov
    if (!asimov) {
      await ctx.runMutation(internal.kb.documents.finishParse, {
        parseServiceJobId: args.parseServiceJobId,
        status: "failed",
        error: "Asimov is not configured"
      })
      return
    }
    const parser = makeParser({
      backend: "asimov",
      ...asimov,
      pollDeadlineMs: ASIMOV_POLL_DEADLINE_MS
    })
    // getResult is optional on the Parser port (only poll-based backends
    // implement it). The asimov backend always does; guard for type-safety.
    if (!parser.getResult) {
      await ctx.runMutation(internal.kb.documents.finishParse, {
        parseServiceJobId: args.parseServiceJobId,
        status: "failed",
        error: "Configured parser backend does not support polling"
      })
      return
    }
    let result: Awaited<ReturnType<NonNullable<typeof parser.getResult>>>
    try {
      result = await parser.getResult(args.parseServiceJobId, "parse")
    } catch (error) {
      if (error instanceof JobNotReadyError) {
        // Heartbeat so the stale-parse reaper doesn't kill a healthy long parse,
        // then re-poll after a short delay (cadence owned here).
        await ctx.runMutation(internal.kb.documents.touchParseActivity, {
          parseServiceJobId: args.parseServiceJobId
        })
        await ctx.scheduler.runAfter(
          ASIMOV_REPOLL_DELAY_MS,
          internal.kb.documents_actions.pollAsimovParse,
          { parseServiceJobId: args.parseServiceJobId }
        )
        return
      }
      await ctx.runMutation(internal.kb.documents.finishParse, {
        parseServiceJobId: args.parseServiceJobId,
        status: "failed",
        error:
          error instanceof Error ? error.message : "Asimov parse poll failed"
      })
      return
    }
    if (result.kind !== "parse") {
      // A parse submission must drain to a parse result; anything else is a bug.
      await ctx.runMutation(internal.kb.documents.finishParse, {
        parseServiceJobId: args.parseServiceJobId,
        status: "failed",
        error: "Asimov returned a non-parse result for a parse job"
      })
      return
    }
    await ctx.runMutation(internal.kb.documents.finishParse, {
      parseServiceJobId: args.parseServiceJobId,
      status: result.status,
      markdown: result.file?.markdown,
      error: result.error
    })
  }
})
