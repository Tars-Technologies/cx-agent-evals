import type { ClassificationTemplate } from "../types.js";
import { CX_TRANSCRIPT_ANALYSIS } from "./cx-transcript-analysis.js";
import { EVAL_DATASET_EXTRACTION } from "./eval-dataset-extraction.js";

const TEMPLATES: ClassificationTemplate[] = [
  CX_TRANSCRIPT_ANALYSIS,
  EVAL_DATASET_EXTRACTION,
];

const TEMPLATE_MAP = new Map(TEMPLATES.map(t => [t.id, t]));

export function listTemplates(): ClassificationTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: string): ClassificationTemplate | undefined {
  return TEMPLATE_MAP.get(id);
}

export { CX_TRANSCRIPT_ANALYSIS, EVAL_DATASET_EXTRACTION };
