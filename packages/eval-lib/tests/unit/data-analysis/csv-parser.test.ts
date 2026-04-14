import { describe, it, expect } from "vitest";
import { parseCSVFromString } from "../../../src/data-analysis/csv-parser.js";

async function collect(
  iter: AsyncIterable<Record<string, string>>,
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of iter) rows.push(row);
  return rows;
}

describe("parseCSVFromString", () => {
  it("should parse a simple header + rows", async () => {
    const text = "a,b,c\n1,2,3\n4,5,6\n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("should handle quoted fields containing newlines", async () => {
    const text = 'name,note\n"Alice","line1\nline2"\n"Bob","single"\n';
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", note: "line1\nline2" });
    expect(rows[1]).toEqual({ name: "Bob", note: "single" });
  });

  it("should trim whitespace around fields", async () => {
    const text = "a,b\n  hello ,  world \n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([{ a: "hello", b: "world" }]);
  });

  it("should skip empty lines", async () => {
    const text = "a,b\n1,2\n\n3,4\n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("should tolerate rows with fewer columns than the header", async () => {
    const text = "a,b,c\n1,2\n3,4,5\n";
    const rows = await collect(parseCSVFromString(text));
    // relax_column_count: true — the short row gets parsed without throwing
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: "3", b: "4", c: "5" });
  });

  it("should return empty for empty string", async () => {
    const rows = await collect(parseCSVFromString(""));
    expect(rows).toEqual([]);
  });
});
