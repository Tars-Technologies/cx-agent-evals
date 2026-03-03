import { describe, it, expect } from "vitest";
import {
  filterLinks,
  normalizeUrl,
} from "../../../src/scraper/link-extractor.js";

describe("normalizeUrl", () => {
  it("should strip trailing slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("should strip fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("should lowercase host", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Page")).toBe(
      "https://example.com/Page",
    );
  });

  it("should sort query params", () => {
    expect(normalizeUrl("https://example.com?b=2&a=1")).toBe(
      "https://example.com?a=1&b=2",
    );
  });

  it("should handle URLs without path", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
});

describe("filterLinks", () => {
  const links = [
    "https://example.com/help/faq",
    "https://example.com/help/contact",
    "https://example.com/login",
    "https://example.com/admin/settings",
    "https://example.com/about",
    "https://other.com/page",
    "https://blog.example.com/post",
  ];

  it("should return all same-domain links when no filters", () => {
    const result = filterLinks(links, "https://example.com");
    expect(result).toContain("https://example.com/help/faq");
    expect(result).toContain("https://example.com/about");
    expect(result).not.toContain("https://other.com/page");
    expect(result).not.toContain("https://blog.example.com/post");
  });

  it("should filter by includePaths", () => {
    const result = filterLinks(links, "https://example.com", {
      includePaths: ["/help/*"],
    });
    expect(result).toEqual([
      "https://example.com/help/faq",
      "https://example.com/help/contact",
    ]);
  });

  it("should filter by excludePaths", () => {
    const result = filterLinks(links, "https://example.com", {
      excludePaths: ["/login", "/admin/*"],
    });
    expect(result).not.toContain("https://example.com/login");
    expect(result).not.toContain("https://example.com/admin/settings");
    expect(result).toContain("https://example.com/help/faq");
  });

  it("should allow subdomains when configured", () => {
    const result = filterLinks(links, "https://example.com", {
      allowSubdomains: true,
    });
    expect(result).toContain("https://blog.example.com/post");
  });

  it("should handle empty input", () => {
    expect(filterLinks([], "https://example.com")).toEqual([]);
  });
});
