/**
 * HMAC scheme for Tarser callbacks. Signs a 5-line canonical string
 * (serviceJobId + "\n" + token + "\n" + timestamp + "\n" + nonce + "\n" +
 * sha256hex(rawBody), no trailing newline) with HMAC-SHA256 and returns
 * lowercase hex - must match tarser/src/tarser/callbacks/hmac_util.py
 * byte-for-byte.
 * Uses Web Crypto so it runs in both the Convex node and default runtimes.
 */
export interface CallbackSignatureArgs {
  serviceJobId: string
  token: string
  timestamp: string
  nonce: string
  bodyHash: string
  secret: string
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function computeBodyHash(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody)
  )
  return toHex(digest)
}

export async function computeCallbackSignature(
  args: CallbackSignatureArgs
): Promise<string> {
  const canonical = [
    args.serviceJobId,
    args.token,
    args.timestamp,
    args.nonce,
    args.bodyHash
  ].join("\n")
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(canonical))
  return toHex(buf)
}

export async function verifyCallbackSignature(
  args: CallbackSignatureArgs & { signature: string }
): Promise<boolean> {
  const expected = await computeCallbackSignature(args)
  const incoming = args.signature.toLowerCase()
  if (expected.length !== incoming.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ incoming.charCodeAt(i)
  }
  return mismatch === 0
}
