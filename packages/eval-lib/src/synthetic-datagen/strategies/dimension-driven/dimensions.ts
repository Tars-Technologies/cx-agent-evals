import { z } from "zod";
import type { Dimension } from "../types.js";

export const DimensionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  values: z.array(z.string().min(1)).min(2),
});

export const DimensionsFileSchema = z.object({
  dimensions: z.array(DimensionSchema).min(1),
});

/**
 * Parse dimensions from raw JSON data (string, object, or array).
 * Accepts both `{ dimensions: [...] }` (file format) and a plain `[...]` array.
 */
export function parseDimensions(data: string | unknown): Dimension[] {
  const raw = typeof data === "string" ? JSON.parse(data) : data;
  if (Array.isArray(raw)) {
    return z.array(DimensionSchema).min(1).parse(raw);
  }
  const parsed = DimensionsFileSchema.parse(raw);
  return parsed.dimensions;
}

/**
 * Load dimensions from a JSON file on disk.
 * Requires Node.js fs APIs — use parseDimensions() in non-Node environments.
 */
export async function loadDimensionsFromFile(
  filePath: string,
): Promise<Dimension[]> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(filePath, "utf-8");
  return parseDimensions(raw);
}

/**
 * @deprecated Use loadDimensionsFromFile or parseDimensions instead.
 */
export const loadDimensions = loadDimensionsFromFile;
