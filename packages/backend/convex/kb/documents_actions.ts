"use node"

/**
 * Parse an uploaded file into markdown, then create the document.
 * - inprocess: parse synchronously here (InProcessParser.parseFile) and create the doc.
 * - tarser: create a "parsing" placeholder and submit to Tarser; parse_done fills it via http.ts.
 */
import { makeParser } from "@tars-inc/eval-lib/scraper"
import type { ParsedFile } from "@tars-inc/eval-lib/scraper"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { backendConfig } from "../config"
import { tarserCallbackUrl } from "./providers"

export const parseDocument = internalAction({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    storageId: v.id("_storage"),
    title: v.string(),
    mimeType: v.string(),
    backend: v.union(v.literal("inprocess"), v.literal("tarser")),
    ocr: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
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
