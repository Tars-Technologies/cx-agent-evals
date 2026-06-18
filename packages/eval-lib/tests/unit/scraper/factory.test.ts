import { describe, expect, it } from "vitest"
import { makeParser, makeScraper } from "../../../src/scraper/factory.js"
import { InProcessParser } from "../../../src/scraper/in-process-parser.js"
import { InProcessScraper } from "../../../src/scraper/in-process-scraper.js"
import { PythonContentService } from "../../../src/scraper/python-content-service.js"

describe("makeScraper", () => {
  it("defaults to InProcessScraper when no config given", () => {
    expect(makeScraper()).toBeInstanceOf(InProcessScraper)
  })
  it("defaults to InProcessScraper when backend omitted", () => {
    expect(makeScraper({})).toBeInstanceOf(InProcessScraper)
  })
  it("builds PythonContentService for backend tarser", () => {
    const s = makeScraper({
      backend: "tarser",
      baseUrl: "u",
      apiToken: "t",
      hmacSecret: "s"
    })
    expect(s).toBeInstanceOf(PythonContentService)
    expect(s.name).toBe("tarser")
  })
})

describe("makeParser", () => {
  it("defaults to InProcessParser", () => {
    expect(makeParser()).toBeInstanceOf(InProcessParser)
  })
  it("builds PythonContentService for backend tarser", () => {
    expect(
      makeParser({
        backend: "tarser",
        baseUrl: "u",
        apiToken: "t",
        hmacSecret: "s"
      })
    ).toBeInstanceOf(PythonContentService)
  })
})
