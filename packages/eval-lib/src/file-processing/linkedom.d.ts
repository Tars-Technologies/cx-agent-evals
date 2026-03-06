declare module "linkedom" {
  export function parseHTML(html: string): {
    document: {
      querySelector(selector: string): { textContent?: string | null; innerHTML?: string } | null;
      querySelectorAll(selector: string): Array<{ getAttribute(name: string): string | null }>;
      body: { innerHTML: string } | null;
    };
  };
}
