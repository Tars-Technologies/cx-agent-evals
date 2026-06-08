/**
 * HMAC scheme for Tarser callbacks. Signs `${jobId}|${token}` (NOT the body) with
 * HMAC-SHA256 and returns lowercase hex - identical to tarser callbacks/hmac_util.py.
 * Uses Web Crypto so it runs in both the Convex node and default runtimes.
 */
export interface CallbackSignatureArgs {
  jobId: string
  token: string
  secret: string
}

export async function computeCallbackSignature(
  args: CallbackSignatureArgs
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const buf = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${args.jobId}|${args.token}`)
  )
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyCallbackSignature(
  args: CallbackSignatureArgs & { signature: string }
): Promise<boolean> {
  const expected = await computeCallbackSignature(args)
  if (expected.length !== args.signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ args.signature.charCodeAt(i)
  }
  return mismatch === 0
}
