import { describe, it, expect } from "vitest";
import { getSeedIndustries, getSeedEntitiesByIndustry, SEED_ENTITIES } from "../../../src/scraper/seed-companies.js";

describe("seed-companies", () => {
  it("has 28 total entities", () => { expect(SEED_ENTITIES).toHaveLength(28); });
  it("returns 6 industries", () => {
    expect(getSeedIndustries()).toHaveLength(6);
    expect(getSeedIndustries()).toContain("finance");
  });
  it("returns 3 finance entities", () => {
    const entities = getSeedEntitiesByIndustry("finance");
    expect(entities).toHaveLength(3);
    expect(entities.map((e) => e.name)).toContain("JPMorgan Chase");
  });
  it("returns 13 government entities (8 states + 5 counties)", () => {
    const entities = getSeedEntitiesByIndustry("government");
    expect(entities).toHaveLength(13);
  });
  it("every entity has required fields", () => {
    for (const e of SEED_ENTITIES) {
      expect(e.name).toBeTruthy();
      expect(e.sourceUrls.length).toBeGreaterThan(0);
    }
  });
});
