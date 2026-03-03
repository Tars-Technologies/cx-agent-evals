import { describe, it, expect } from "vitest";
import {
  SEED_ENTITIES,
  getSeedIndustries,
  getSeedEntitiesByIndustry,
} from "../../../src/scraper/seed-companies.js";

describe("seed companies", () => {
  it("should have 28 entities total", () => {
    expect(SEED_ENTITIES).toHaveLength(28);
  });

  it("should return 6 industries", () => {
    const industries = getSeedIndustries();
    expect(industries).toHaveLength(6);
    expect(industries).toContain("finance");
    expect(industries).toContain("insurance");
    expect(industries).toContain("healthcare");
    expect(industries).toContain("telecom");
    expect(industries).toContain("education");
    expect(industries).toContain("government");
  });

  it("should return 3 finance entities", () => {
    const finance = getSeedEntitiesByIndustry("finance");
    expect(finance).toHaveLength(3);
    expect(finance.map((e) => e.name)).toContain("JPMorgan Chase");
  });

  it("should return 13 government entities (8 states + 5 counties)", () => {
    const gov = getSeedEntitiesByIndustry("government");
    expect(gov).toHaveLength(13);
  });

  it("should return empty array for unknown industry", () => {
    expect(getSeedEntitiesByIndustry("unknown")).toEqual([]);
  });

  it("every entity should have required fields", () => {
    for (const entity of SEED_ENTITIES) {
      expect(entity.name).toBeTruthy();
      expect(entity.industry).toBeTruthy();
      expect(entity.subIndustry).toBeTruthy();
      expect(entity.entityType).toBeTruthy();
      expect(entity.sourceUrls.length).toBeGreaterThan(0);
      expect(entity.tags.length).toBeGreaterThan(0);
    }
  });
});
