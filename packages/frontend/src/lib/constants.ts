export const INDUSTRIES = [
  "finance",
  "insurance",
  "healthcare",
  "telecom",
  "education",
  "government",
  "other",
] as const;

export const ENTITY_TYPES = [
  "company",
  "government-state",
  "government-county",
  "industry-aggregate",
] as const;

// ── localStorage helpers ──

const KB_CREATE_CONFIG_KEY = "rag-eval:kb-create-config";
const IMPORT_URL_CONFIG_KEY = "rag-eval:import-url-config";
const CURRENT_VERSION = 1;

export interface KBCreateConfig {
  version: typeof CURRENT_VERSION;
  company: string;
  companyUrl: string;
  industry: string;
  customIndustry: string;
  entityType: string;
}

export interface ImportUrlConfig {
  version: typeof CURRENT_VERSION;
  maxPages: number;
  includePaths: string[];
  excludePaths: string[];
  maxDepth: number;
  allowSubdomains: boolean;
  concurrency: number;
  delay: number;
}

export function loadKBCreateConfig(): KBCreateConfig | null {
  try {
    const raw = localStorage.getItem(KB_CREATE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CURRENT_VERSION) return null;
    return parsed as KBCreateConfig;
  } catch {
    return null;
  }
}

export function saveKBCreateConfig(config: Omit<KBCreateConfig, "version">): void {
  try {
    localStorage.setItem(
      KB_CREATE_CONFIG_KEY,
      JSON.stringify({ ...config, version: CURRENT_VERSION }),
    );
  } catch {
    // silent fallback — private browsing or storage full
  }
}

export function loadImportUrlConfig(): ImportUrlConfig | null {
  try {
    const raw = localStorage.getItem(IMPORT_URL_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CURRENT_VERSION) return null;
    return parsed as ImportUrlConfig;
  } catch {
    return null;
  }
}

export function saveImportUrlConfig(config: Omit<ImportUrlConfig, "version">): void {
  try {
    localStorage.setItem(
      IMPORT_URL_CONFIG_KEY,
      JSON.stringify({ ...config, version: CURRENT_VERSION }),
    );
  } catch {
    // silent fallback
  }
}
