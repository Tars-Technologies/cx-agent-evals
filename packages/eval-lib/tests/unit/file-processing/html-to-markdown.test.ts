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

  it("removes nav, header, footer, aside when onlyMainContent is true", async () => {
    const html = `<html><body>
    <nav><ul><li>Home</li><li>About</li></ul></nav>
    <header><div>Site Header Banner</div></header>
    <main><h1>Main Content</h1><p>Important text here</p></main>
    <aside><p>Sidebar widget</p></aside>
    <footer><p>Copyright 2024</p></footer>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });
    expect(result.content).toContain("Main Content");
    expect(result.content).toContain("Important text here");
    expect(result.content).not.toContain("Home");
    expect(result.content).not.toContain("Site Header Banner");
    expect(result.content).not.toContain("Sidebar widget");
    expect(result.content).not.toContain("Copyright 2024");
  });

  it("preserves content with overflow-hidden class (Tailwind regression)", async () => {
    const html = `<html><body>
    <div class="card-group">
      <div class="card overflow-hidden rounded-2xl">
        <h3>AI Agent</h3>
        <p>Handles customer conversations</p>
      </div>
      <div class="card overflow-hidden rounded-2xl">
        <h3>Knowledge Base</h3>
        <p>Stores training data</p>
      </div>
    </div>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });
    expect(result.content).toContain("AI Agent");
    expect(result.content).toContain("Knowledge Base");
    expect(result.content).toContain("Handles customer conversations");
  });

  it("preserves details/summary accordion elements", async () => {
    const html = `<html><body>
    <div class="accordion-group overflow-hidden">
      <details class="accordion overflow-hidden">
        <summary>Why aren't my Gambits executing?</summary>
        <p>Check your gambit conditions and triggers.</p>
      </details>
      <details class="accordion overflow-hidden">
        <summary>How many Gambits should I use?</summary>
        <p>Start with 3-5 gambits per flow.</p>
      </details>
    </div>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });
    expect(result.content).toContain("Gambits executing");
    expect(result.content).toContain("gambit conditions");
    expect(result.content).toContain("How many Gambits");
  });

  it("removes cookie banner elements", async () => {
    const html = `<html><body>
    <div class="cookie-banner"><p>We use cookies</p><button>Accept</button></div>
    <main><h1>Page Content</h1></main>
    <div id="gdpr"><p>GDPR notice</p></div>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });
    expect(result.content).toContain("Page Content");
    expect(result.content).not.toContain("We use cookies");
    expect(result.content).not.toContain("GDPR notice");
  });

  it("removes script, style, noscript, and iframe elements", async () => {
    const html = `<html><body>
    <script>console.log("track")</script>
    <style>.nav { color: red }</style>
    <noscript>Enable JavaScript</noscript>
    <iframe src="https://ads.example.com"></iframe>
    <main><p>Real content</p></main>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: true });
    expect(result.content).toContain("Real content");
    expect(result.content).not.toContain("track");
    expect(result.content).not.toContain("color: red");
    expect(result.content).not.toContain("Enable JavaScript");
  });

  it("returns full unmodified content when onlyMainContent is false", async () => {
    const html = `<html><body>
    <nav>Navigation</nav>
    <main><h1>Main</h1></main>
    <footer>Footer</footer>
  </body></html>`;
    const result = await htmlToMarkdown(html, { onlyMainContent: false });
    expect(result.content).toContain("Navigation");
    expect(result.content).toContain("Main");
    expect(result.content).toContain("Footer");
  });
});
