import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../../../src/file-processing/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("converts simple HTML to markdown", async () => {
    const result = await htmlToMarkdown(
      "<html><body><h1>Hello</h1><p>World</p></body></html>",
    );
    expect(result.content).toContain("Hello");
    expect(result.content).toContain("World");
    expect(result.title).toBe("Hello");
  });

  it("extracts links from HTML", async () => {
    const html = `<html><body>
      <a href="https://example.com/page1">Link 1</a>
      <a href="/relative">Relative</a>
    </body></html>`;
    const result = await htmlToMarkdown(html, { baseUrl: "https://example.com" });
    expect(result.links).toContain("https://example.com/page1");
    expect(result.links).toContain("https://example.com/relative");
  });

  it("normalizes whitespace and collapses blank lines", async () => {
    const html = "<html><body><p>Hello</p>\n\n\n\n<p>World</p></body></html>";
    const result = await htmlToMarkdown(html);
    expect(result.content).not.toMatch(/\n{3,}/);
  });

  it("returns full content when onlyMainContent is false", async () => {
    const html = `<html><body>
      <nav>Navigation</nav>
      <article><h1>Main</h1></article>
      <footer>Footer</footer>
    </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: false });
    expect(result.content).toContain("Navigation");
    expect(result.content).toContain("Footer");
  });
});
