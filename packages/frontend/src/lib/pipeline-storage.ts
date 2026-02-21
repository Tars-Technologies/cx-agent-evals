import type { SavedPipelineConfig } from "./pipeline-types";

const CONFIGS_KEY = "rag-eval:pipeline-configs";
const LAST_CONFIG_KEY = "rag-eval:last-pipeline-config";

/** Load all saved pipeline configs from localStorage. */
export function loadSavedConfigs(): Record<string, SavedPipelineConfig> {
  try {
    const raw = localStorage.getItem(CONFIGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SavedPipelineConfig>;
  } catch {
    return {};
  }
}

/** Save a pipeline config to localStorage. */
export function saveConfig(config: SavedPipelineConfig): void {
  const existing = loadSavedConfigs();
  existing[config.name] = config;
  localStorage.setItem(CONFIGS_KEY, JSON.stringify(existing));
  localStorage.setItem(LAST_CONFIG_KEY, config.name);
}

/** Load the last-used pipeline config from localStorage. */
export function loadLastConfig(): SavedPipelineConfig | null {
  const lastName = localStorage.getItem(LAST_CONFIG_KEY);
  if (!lastName) return null;
  const configs = loadSavedConfigs();
  return configs[lastName] ?? null;
}

/** Delete a saved pipeline config from localStorage. */
export function deleteConfig(name: string): void {
  const existing = loadSavedConfigs();
  delete existing[name];
  localStorage.setItem(CONFIGS_KEY, JSON.stringify(existing));
  // If the deleted config was the last-used, clear that too
  const lastName = localStorage.getItem(LAST_CONFIG_KEY);
  if (lastName === name) {
    localStorage.removeItem(LAST_CONFIG_KEY);
  }
}

/** Set the last-used config name. */
export function setLastConfigName(name: string): void {
  localStorage.setItem(LAST_CONFIG_KEY, name);
}

/**
 * Generate a 4-character hash from a config diff for naming.
 * Uses a simple djb2-style hash (no crypto dependency needed in browser).
 */
export function configHash(configJson: string): string {
  let hash = 5381;
  for (let i = 0; i < configJson.length; i++) {
    hash = ((hash << 5) + hash + configJson.charCodeAt(i)) | 0;
  }
  // Convert to unsigned hex, take last 4 chars
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return hex.slice(-4);
}
