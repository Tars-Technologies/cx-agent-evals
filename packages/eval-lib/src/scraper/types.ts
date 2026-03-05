export interface ScrapedPage {
  url: string;
  markdown: string;
  metadata: {
    title: string;
    sourceURL: string;
    description?: string;
    language?: string;
    statusCode: number;
    links: string[];
  };
}

export interface ScrapeOptions {
  onlyMainContent?: boolean;
  includeLinks?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface SeedEntity {
  name: string;
  industry: string;
  subIndustry: string;
  entityType: "company" | "government-state" | "government-county" | "industry-aggregate";
  sourceUrls: string[];
  tags: string[];
  notes?: string;
}
