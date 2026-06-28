import { describe, expect, it, vi } from "vitest"
import { CallbackVectorStore } from "../../../src/vector-stores/callback.js"

describe("CallbackVectorStore", () => {
  it("delegates search with exact args", async () => {
    const search = vi.fn().mockResolvedValue([])
    const store = new CallbackVectorStore({ name: "test", search })
    await store.search([1, 2], { k: 5, filter: { kbId: "kb1" } })
    expect(search).toHaveBeenCalledWith([1, 2], {
      k: 5,
      filter: { kbId: "kb1" }
    })
  })

  it("throws a named error for missing optional methods", async () => {
    const store = new CallbackVectorStore({
      name: "convex-native",
      search: async () => []
    })
    await expect(store.add([], [])).rejects.toThrow(
      "convex-native does not support add"
    )
    await expect(store.deleteByDocument("d1")).rejects.toThrow(
      "convex-native does not support deleteByDocument"
    )
    await expect(store.deleteByKnowledgeBase("kb1")).rejects.toThrow(
      "convex-native does not support deleteByKnowledgeBase"
    )
    await expect(store.clear()).rejects.toThrow(
      "convex-native does not support clear"
    )
  })

  it("checkHealth defaults to true and delegates when provided", async () => {
    const plain = new CallbackVectorStore({ name: "t", search: async () => [] })
    expect(await plain.checkHealth()).toBe(true)
    const withHealth = new CallbackVectorStore({
      name: "t",
      search: async () => [],
      checkHealth: async () => false
    })
    expect(await withHealth.checkHealth()).toBe(false)
  })

  it("is dense-only by default: supportsSparse false, searchSparse no-ops", async () => {
    const store = new CallbackVectorStore({ name: "t", search: async () => [] })
    expect(store.supportsSparse).toBe(false)
    expect(
      await store.searchSparse("q", { k: 5, filter: { kbId: "kb1" } })
    ).toEqual([])
  })

  it("advertises sparse support and delegates searchSparse when supplied", async () => {
    const searchSparse = vi
      .fn()
      .mockResolvedValue([{ chunk: { id: "c1" }, score: 1 }])
    const store = new CallbackVectorStore({
      name: "t",
      search: async () => [],
      searchSparse
    })
    expect(store.supportsSparse).toBe(true)
    const out = await store.searchSparse("q", { k: 3, filter: { kbId: "kb1" } })
    expect(searchSparse).toHaveBeenCalledWith("q", {
      k: 3,
      filter: { kbId: "kb1" }
    })
    expect(out).toHaveLength(1)
  })

  it("supportsSparse can be forced false even with a searchSparse callback", async () => {
    const store = new CallbackVectorStore({
      name: "t",
      search: async () => [],
      searchSparse: async () => [],
      supportsSparse: false
    })
    expect(store.supportsSparse).toBe(false)
  })

  it("delegates delete callbacks", async () => {
    const deleteByDocument = vi.fn().mockResolvedValue(undefined)
    const store = new CallbackVectorStore({
      name: "t",
      search: async () => [],
      deleteByDocument
    })
    await store.deleteByDocument("d1", { kbId: "kb1" })
    expect(deleteByDocument).toHaveBeenCalledWith("d1", { kbId: "kb1" })
  })
})
