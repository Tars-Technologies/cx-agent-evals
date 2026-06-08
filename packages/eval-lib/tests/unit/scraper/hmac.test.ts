import {
  computeBodyHash,
  computeCallbackSignature,
  verifyCallbackSignature
} from "../../../src/scraper/hmac.js"

const BODY = '{"event":"url_done","service_job_id":"JID"}'
const ARGS = {
  serviceJobId: "JID",
  token: "tok",
  timestamp: "1700000000",
  nonce: "00112233445566778899aabbccddeeff",
  secret: "dev-token"
}

describe("computeBodyHash", () => {
  it("matches known SHA-256 vectors (lowercase hex)", async () => {
    expect(await computeBodyHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
    expect(await computeBodyHash(BODY)).toBe(
      "e989503d47b74b0f844e09085e9e3f9dbe0c4ef390ffa43733a76c5c70eedd13"
    )
  })
})

describe("computeCallbackSignature", () => {
  it("matches the frozen-protocol vector (5-line canonical, sha256 hmac, hex)", async () => {
    const bodyHash = await computeBodyHash(BODY)
    const sig = await computeCallbackSignature({ ...ARGS, bodyHash })
    expect(sig).toBe(
      "6800b4a4b90aa1d763867b7d4f25c4bc82ffddd70a59bc672a74fa3cabab505f"
    )
  })

  it("verifyCallbackSignature accepts a matching signature and rejects a wrong one", async () => {
    const bodyHash = await computeBodyHash(BODY)
    const good = await computeCallbackSignature({ ...ARGS, bodyHash })
    expect(
      await verifyCallbackSignature({ ...ARGS, bodyHash, signature: good })
    ).toBe(true)
    expect(
      await verifyCallbackSignature({
        ...ARGS,
        bodyHash,
        signature: "deadbeef"
      })
    ).toBe(false)
    // Any tampered canonical field invalidates the signature.
    expect(
      await verifyCallbackSignature({
        ...ARGS,
        timestamp: "1700000001",
        bodyHash,
        signature: good
      })
    ).toBe(false)
  })
})
