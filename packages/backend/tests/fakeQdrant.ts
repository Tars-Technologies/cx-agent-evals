/**
 * In-memory Qdrant stand-in for backend tests. Install via
 * `vi.stubGlobal("fetch", fake.fetch)` and set `process.env.QDRANT_URL` before
 * the first action runs, so the media store (kb/media_runtime.ts) talks to this
 * instead of a real Qdrant. Implements only the REST surface QdrantMediaStore
 * uses: collection ensure/create, payload-index PUT, points upsert, points
 * retrieve-by-id, and points delete (by id list or by kbId+sourceDocId filter).
 */

interface StoredPoint {
  vector: number[]
  payload: Record<string, unknown>
}

export class FakeQdrant {
  private collections = new Map<string, Map<string, StoredPoint>>()

  fetch = async (
    url: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const u = new URL(typeof url === "string" ? url : url.toString())
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const parts = u.pathname.split("/").filter(Boolean) // ["collections", name, ...]
    const collection = parts[1]

    const ok = (result: unknown) =>
      new Response(JSON.stringify({ status: "ok", result }), { status: 200 })
    const notFound = () =>
      new Response(JSON.stringify({ status: { error: "not found" } }), {
        status: 404
      })

    // GET /collections/{c} — collection info (dimension lookup / health)
    if (method === "GET" && parts.length === 2) {
      const points = this.collections.get(collection)
      if (!points) return notFound()
      const dim = points.size
        ? [...points.values()][0].vector.length
        : this.dims.get(collection) ?? 0
      return ok({ config: { params: { vectors: { size: dim, distance: "Cosine" } } } })
    }

    // PUT /collections/{c} — create collection
    if (method === "PUT" && parts.length === 2) {
      if (!this.collections.has(collection)) {
        this.collections.set(collection, new Map())
      }
      const size = body?.vectors?.size
      if (typeof size === "number") this.dims.set(collection, size)
      return ok(true)
    }

    // PUT /collections/{c}/index — payload index (no-op)
    if (method === "PUT" && parts[2] === "index") {
      return ok(true)
    }

    // PUT /collections/{c}/points — upsert
    if (method === "PUT" && parts[2] === "points") {
      const points = this.ensure(collection)
      for (const p of body.points as Array<{
        id: string
        vector: number[]
        payload: Record<string, unknown>
      }>) {
        points.set(p.id, { vector: p.vector, payload: p.payload })
      }
      return ok({ status: "completed" })
    }

    // POST /collections/{c}/points/delete — delete by ids or filter
    if (method === "POST" && parts[2] === "points" && parts[3] === "delete") {
      const points = this.collections.get(collection)
      if (!points) return notFound()
      if (Array.isArray(body.points)) {
        for (const id of body.points as string[]) points.delete(id)
      } else if (body.filter?.must) {
        const conds = body.filter.must as Array<{
          key: string
          match: { value: unknown }
        }>
        for (const [id, pt] of [...points]) {
          if (conds.every((c) => pt.payload[c.key] === c.match.value)) {
            points.delete(id)
          }
        }
      }
      return ok({ status: "completed" })
    }

    // POST /collections/{c}/points — retrieve by ids
    if (method === "POST" && parts[2] === "points" && parts.length === 3) {
      const points = this.collections.get(collection)
      if (!points) return notFound()
      const result = (body.ids as string[])
        .map((id) => {
          const pt = points.get(id)
          return pt
            ? { id, vector: pt.vector, payload: pt.payload }
            : undefined
        })
        .filter(Boolean)
      return ok(result)
    }

    throw new Error(`FakeQdrant: unhandled ${method} ${u.pathname}`)
  }

  private dims = new Map<string, number>()

  private ensure(collection: string): Map<string, StoredPoint> {
    let points = this.collections.get(collection)
    if (!points) {
      points = new Map()
      this.collections.set(collection, points)
    }
    return points
  }

  /** All stored points for a collection, keyed by point id. */
  pointsIn(collection: string): Map<string, StoredPoint> {
    return this.collections.get(collection) ?? new Map()
  }

  /** Total stored points across all collections (quick assertion helper). */
  totalPoints(): number {
    let n = 0
    for (const c of this.collections.values()) n += c.size
    return n
  }

  reset(): void {
    this.collections.clear()
    this.dims.clear()
  }
}
