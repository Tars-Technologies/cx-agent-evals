import { AsimovContentService } from "./asimov-content-service.js"
import { InProcessParser } from "./in-process-parser.js"
import { InProcessScraper } from "./in-process-scraper.js"
import type { Parser, ParserConfig, Scraper, ScraperConfig } from "./ports.js"
import { PythonContentService } from "./python-content-service.js"

/** Build a Scraper from config. Defaults to the in-process backend. */
export function makeScraper(config?: ScraperConfig): Scraper {
  if (config && config.backend === "tarser") {
    return new PythonContentService({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      hmacSecret: config.hmacSecret
    })
  }
  if (config && config.backend === "asimov") {
    return new AsimovContentService({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken
    })
  }
  return new InProcessScraper(
    config && "userAgent" in config && config.userAgent
      ? { userAgent: config.userAgent }
      : undefined
  )
}

/** Build a Parser from config. Defaults to the in-process backend. */
export function makeParser(config?: ParserConfig): Parser {
  if (config && config.backend === "tarser") {
    return new PythonContentService({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      hmacSecret: config.hmacSecret
    })
  }
  if (config && config.backend === "asimov") {
    return new AsimovContentService({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken
    })
  }
  return new InProcessParser()
}
