import { describe, expect, it } from "vitest"
import { DEFAULT_MODEL, getModel } from "../../src/llm/config.js"

describe("llm/config", () => {
  describe("DEFAULT_MODEL", () => {
    it("is gpt-4o", () => {
      expect(DEFAULT_MODEL).toBe("gpt-4o")
    })
  })

  describe("getModel", () => {
    it("returns model from config when specified", () => {
      expect(getModel({ model: "gpt-4o-mini" })).toBe("gpt-4o-mini")
    })

    it("falls back to DEFAULT_MODEL when model is not in config", () => {
      expect(getModel({})).toBe(DEFAULT_MODEL)
    })

    it("falls back to DEFAULT_MODEL when model is undefined", () => {
      expect(getModel({ model: undefined })).toBe(DEFAULT_MODEL)
    })

    it("uses model value even if other config keys are present", () => {
      expect(getModel({ model: "gpt-3.5-turbo", temperature: 0.7 })).toBe(
        "gpt-3.5-turbo"
      )
    })
  })
})
