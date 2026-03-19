import { describe, it, expect } from "vitest";
import type {
  RegistryEntry,
  OptionDef,
  Choice,
  PresetEntry,
} from "../../../src/registry/types.js";

describe("Registry types", () => {
  it("RegistryEntry is structurally valid", () => {
    const entry: RegistryEntry = {
      id: "test",
      name: "Test",
      description: "A test entry",
      status: "available",
      options: [],
      defaults: {},
    };
    expect(entry.id).toBe("test");
    expect(entry.status).toBe("available");
  });

  it("RegistryEntry supports coming-soon status", () => {
    const entry: RegistryEntry = {
      id: "future",
      name: "Future",
      description: "Not yet implemented",
      status: "coming-soon",
      tags: ["experimental"],
      options: [],
      defaults: {},
    };
    expect(entry.status).toBe("coming-soon");
    expect(entry.tags).toContain("experimental");
  });

  it("OptionDef supports all field types", () => {
    const selectOpt: OptionDef = {
      key: "model",
      label: "Model",
      description: "Which model to use",
      type: "select",
      choices: [
        { value: "a", label: "A" },
        { value: "b", label: "B", description: "The B model" },
      ],
      default: "a",
    };
    expect(selectOpt.choices).toHaveLength(2);

    const numberOpt: OptionDef = {
      key: "size",
      label: "Size",
      description: "Chunk size",
      type: "number",
      default: 1000,
      constraints: { min: 100, max: 10000, step: 100 },
    };
    expect(numberOpt.constraints?.min).toBe(100);

    const boolOpt: OptionDef = {
      key: "merge",
      label: "Merge",
      description: "Merge small sections",
      type: "boolean",
      default: true,
    };
    expect(boolOpt.default).toBe(true);

    const advancedOpt: OptionDef = {
      key: "prompt",
      label: "Prompt",
      description: "Custom prompt",
      type: "string",
      default: "",
      advanced: true,
    };
    expect(advancedOpt.advanced).toBe(true);
  });

  it("PresetEntry extends RegistryEntry with config metadata", () => {
    const preset: PresetEntry = {
      id: "test-preset",
      name: "Test Preset",
      description: "A test preset",
      status: "available",
      complexity: "basic",
      requiresLLM: false,
      requiresReranker: false,
      config: { name: "test-preset", search: { strategy: "dense" } },
      stages: {
        index: "Plain (1000 chars, 200 overlap)",
        query: "Identity (passthrough)",
        search: "Dense vector search",
        refinement: "None",
      },
      options: [],
      defaults: {},
    };
    expect(preset.complexity).toBe("basic");
    expect(preset.config.name).toBe("test-preset");
  });
});
