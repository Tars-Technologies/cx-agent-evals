import { getLangSmithClient } from "./get-client.js";

export interface CreateExperimentOptions {
  datasetName: string;
  experimentName: string;
  metadata?: Record<string, unknown>;
}

export interface CreateExperimentResult {
  experimentId: string;
  experimentUrl: string;
}

/**
 * Create a new LangSmith experiment using the raw client API.
 * This allows creating an experiment without using the high-level evaluate() wrapper,
 * enabling per-question parallel evaluation.
 */
export async function createLangSmithExperiment(
  options: CreateExperimentOptions,
): Promise<CreateExperimentResult> {
  const client = await getLangSmithClient();

  // Resolve dataset by name to get its ID
  const dataset = await client.readDataset({ datasetName: options.datasetName });

  // Create a project (experiment) linked to the dataset
  const project = await client.createProject({
    projectName: options.experimentName,
    referenceDatasetId: dataset.id,
    metadata: options.metadata,
  });

  // Build the experiment URL
  const baseUrl = process.env.LANGSMITH_ENDPOINT ?? "https://smith.langchain.com";
  const experimentUrl = `${baseUrl}/projects/p/${project.id}`;

  return {
    experimentId: project.id,
    experimentUrl,
  };
}

export interface LogResultOptions {
  experimentId: string;
  datasetExampleId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  referenceOutput?: Record<string, unknown>;
  scores: Record<string, number>;
}

/**
 * Log a single evaluation result to an existing LangSmith experiment.
 * Creates a run in the project and attaches feedback scores.
 */
export async function logLangSmithResult(
  options: LogResultOptions,
): Promise<void> {
  const client = await getLangSmithClient();

  // Create a run in the experiment project
  const runId = crypto.randomUUID();

  await client.createRun({
    id: runId,
    name: "evaluation",
    run_type: "chain",
    project_name: undefined,
    session_id: options.experimentId,
    inputs: options.input,
    outputs: options.output,
    reference_example_id: options.datasetExampleId,
  });

  // Mark run as complete
  await client.updateRun(runId, {
    end_time: new Date().toISOString(),
  });

  // Attach scores as feedback
  for (const [key, value] of Object.entries(options.scores)) {
    await client.createFeedback(runId, key, {
      score: value,
    });
  }
}
