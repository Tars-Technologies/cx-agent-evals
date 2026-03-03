import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "../../../src/file-processing/html-to-markdown.js";

describe("htmlToMarkdown", () => {
  it("should convert simple HTML to markdown", async () => {
    const html = `
      <html><head><title>Test Page</title></head>
      <body>
        <article>
          <h1>Hello World</h1>
          <p>This is a <strong>test</strong> paragraph.</p>
          <p>Second paragraph with a <a href="https://example.com/page">link</a>.</p>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html);

    expect(result.title).toBe("Test Page");
    expect(result.content).toContain("Hello World");
    expect(result.content).toContain("**test**");
    expect(result.content).toContain("[link](https://example.com/page)");
    expect(result.metadata.sourceFormat).toBe("html");
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it("should extract links from HTML", async () => {
    const html = `
      <html><head><title>Links Page</title></head>
      <body>
        <article>
          <p>Content here.</p>
          <a href="https://example.com/page1">Page 1</a>
          <a href="https://example.com/page2">Page 2</a>
          <a href="/relative">Relative</a>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, {
      baseUrl: "https://example.com",
    });

    expect(result.metadata.links).toBeDefined();
    expect(result.metadata.links).toContain("https://example.com/page1");
    expect(result.metadata.links).toContain("https://example.com/page2");
    expect(result.metadata.links).toContain("https://example.com/relative");
  });

  it("should extract main content when onlyMainContent is true", async () => {
    const html = `
      <html><head><title>Article</title></head>
      <body>
        <nav><a href="/home">Home</a><a href="/about">About</a></nav>
        <article>
          <h1>Main Article Title</h1>
          <p>This is the main article content that is long enough for readability to detect it as the primary content of the page. It needs to be sufficiently long so the algorithm identifies it properly. Here is more text to make it substantial enough for the content extraction algorithm.</p>
          <p>Another paragraph with substantial content to ensure readability picks this up as the main article. The content needs several paragraphs to be detected properly by the Mozilla Readability algorithm.</p>
        </article>
        <footer>Copyright 2024</footer>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });

    expect(result.content).toContain("Main Article Title");
    expect(result.content).toContain("main article content");
    // Nav and footer should be stripped by readability
    expect(result.content).not.toContain("Copyright 2024");
  });

  it("should strip links when includeLinks is false", async () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <article>
          <p>Visit <a href="https://example.com">our site</a> for more.</p>
        </article>
      </body></html>
    `;
    const result = await htmlToMarkdown(html, { includeLinks: false });

    expect(result.content).toContain("our site");
    expect(result.content).not.toContain("https://example.com");
  });

  it("should handle empty or minimal HTML", async () => {
    const html = `<html><head><title></title></head><body></body></html>`;
    const result = await htmlToMarkdown(html);

    expect(result.content).toBe("");
    expect(result.title).toBe("");
    expect(result.metadata.wordCount).toBe(0);
  });
});
