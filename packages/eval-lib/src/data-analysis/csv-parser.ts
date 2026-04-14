import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { parse } from "csv-parse";

/**
 * Stream a CSV file row-by-row. Handles quoted fields with newlines.
 * Yields one Record<string, string> per CSV row (header-mapped).
 */
export async function* parseCSV(
  filePath: string
): AsyncIterable<Record<string, string>> {
  const parser = createReadStream(filePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    })
  );

  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

/**
 * Parse a CSV string (already loaded into memory) row-by-row.
 * Used when the source is not a filesystem path — e.g., a Convex
 * file storage blob fetched as text.
 * Handles quoted fields with newlines. Yields one Record per row.
 */
export async function* parseCSVFromString(
  text: string,
): AsyncIterable<Record<string, string>> {
  const parser = Readable.from([text]).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }),
  );

  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

/**
 * Parse CLI args from process.argv.
 * Supports: --input, --output, --limit, --concurrency
 */
export function parseCLIArgs(argv: string[]): {
  input: string;
  output: string;
  limit?: number;
  concurrency?: number;
} {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }

  if (!args.input) throw new Error("Missing --input argument");
  if (!args.output) throw new Error("Missing --output argument");

  return {
    input: args.input,
    output: args.output,
    limit: args.limit ? parseInt(args.limit, 10) : undefined,
    concurrency: args.concurrency ? parseInt(args.concurrency, 10) : undefined,
  };
}
