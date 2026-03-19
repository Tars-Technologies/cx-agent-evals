import { describe, it, expect } from "vitest";
import { parseVariants } from "../../../../../src/retrievers/pipeline/query/utils.js";

describe("parseVariants", () => {
  it("should split newline-separated queries", () => {
    const text = "query about dogs\nquery about cats\nquery about birds";
    expect(parseVariants(text, 3)).toEqual([
      "query about dogs",
      "query about cats",
      "query about birds",
    ]);
  });

  it("should strip numbering prefixes (dot and paren styles)", () => {
    const text = "1. first query\n2. second query\n3. third query";
    expect(parseVariants(text, 3)).toEqual([
      "first query",
      "second query",
      "third query",
    ]);

    const parenStyle = "1) first query\n2) second query\n3) third query";
    expect(parseVariants(parenStyle, 3)).toEqual([
      "first query",
      "second query",
      "third query",
    ]);
  });

  it("should filter empty lines", () => {
    const text = "query one\n\n\nquery two\n\nquery three";
    expect(parseVariants(text, 3)).toEqual([
      "query one",
      "query two",
      "query three",
    ]);
  });

  it("should limit to expectedCount", () => {
    const text = "q1\nq2\nq3\nq4\nq5";
    expect(parseVariants(text, 3)).toEqual(["q1", "q2", "q3"]);
  });

  it("should handle fewer results than expected", () => {
    const text = "only one";
    expect(parseVariants(text, 3)).toEqual(["only one"]);
  });

  it("should trim whitespace from each line", () => {
    const text = "  query one  \n  query two  ";
    expect(parseVariants(text, 2)).toEqual(["query one", "query two"]);
  });

  it("should handle dash-prefixed lines", () => {
    const text = "- first query\n- second query";
    expect(parseVariants(text, 2)).toEqual(["first query", "second query"]);
  });
});
