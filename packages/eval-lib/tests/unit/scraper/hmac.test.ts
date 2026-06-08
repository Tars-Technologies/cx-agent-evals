import { describe, expect, it } from "vitest"
import {
  computeCallbackSignature,
  verifyCallbackSignature
} from "../../../src/scraper/hmac.js"

describe("computeCallbackSignature", () => {
  it("matches the live Tarser HMAC vector (job_id|token, sha256, hex)", async () => {
    const sig = await computeCallbackSignature({
      jobId: "JID",
      token: "tok",
      secret: "dev-token"
    })
    expect(sig).toBe(
      "74b82d9a08ed9c9f5628c95cf6f66d5e4b692747ecbfc8dd544aa486b7bb1563"
    )
  })

  it("verifyCallbackSignature accepts a matching signature and rejects a wrong one", async () => {
    const good = await computeCallbackSignature({
      jobId: "JID",
      token: "tok",
      secret: "dev-token"
    })
    expect(
      await verifyCallbackSignature({
        jobId: "JID",
        token: "tok",
        secret: "dev-token",
        signature: good
      })
    ).toBe(true)
    expect(
      await verifyCallbackSignature({
        jobId: "JID",
        token: "tok",
        secret: "dev-token",
        signature: "deadbeef"
      })
    ).toBe(false)
  })
})
