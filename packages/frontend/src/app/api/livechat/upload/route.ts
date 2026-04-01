import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// process.cwd() in Next.js dev = packages/frontend, so ../../data = repo root/data
// In production, use an env var DATA_DIR instead
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "..", "..", "data");
const UPLOADS_DIR = join(DATA_DIR, "uploads");
const OUTPUT_DIR = join(DATA_DIR, "output");
const MANIFEST_PATH = join(UPLOADS_DIR, "manifest.json");

interface ManifestEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  status: string;
  conversationCount?: number;
  error?: string;
  outputFiles?: {
    rawTranscripts: string;
    microtopics: string;
    basicStats: string;
  };
}

function readManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function writeManifest(entries: ManifestEntry[]) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const id = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50)}`;
    mkdirSync(UPLOADS_DIR, { recursive: true });
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const csvPath = join(UPLOADS_DIR, `${id}.csv`);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(csvPath, buffer);

    const manifest = readManifest();
    const entry: ManifestEntry = {
      id,
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      status: "parsing",
    };
    manifest.push(entry);
    writeManifest(manifest);

    // Run processing pipeline in background (non-blocking)
    // In production this would be a job queue; for now, run synchronously
    try {
      const evalLibDir = join(process.cwd(), "..", "eval-lib");
      const statsPath = join(OUTPUT_DIR, `basic-stats-${id}.json`);
      const rawPath = join(OUTPUT_DIR, `raw-transcripts-${id}.json`);
      const mtPath = join(OUTPUT_DIR, `microtopics-${id}.json`);

      // Step 1+2: Parse + Stats (parallel via sequential exec for simplicity)
      execSync(
        `npx tsx src/data-analysis/run-stats.ts --input "${csvPath}" --output "${statsPath}"`,
        { cwd: evalLibDir, stdio: "pipe" }
      );
      execSync(
        `npx tsx src/data-analysis/run-parse.ts --input "${csvPath}" --output "${rawPath}"`,
        { cwd: evalLibDir, stdio: "pipe" }
      );

      // Read conversation count from raw transcripts
      const rawData = JSON.parse(readFileSync(rawPath, "utf-8"));
      entry.conversationCount = rawData.totalConversations;
      entry.status = "analyzing";
      writeManifest(manifest);

      // Step 3: Microtopics (limit 200)
      execSync(
        `npx tsx src/data-analysis/run-microtopics.ts --input "${rawPath}" --output "${mtPath}" --limit 200 --concurrency 10`,
        { cwd: evalLibDir, stdio: "pipe", timeout: 600000 }
      );

      entry.status = "ready";
      entry.outputFiles = {
        rawTranscripts: rawPath,
        microtopics: mtPath,
        basicStats: statsPath,
      };
      writeManifest(manifest);
    } catch (err: any) {
      entry.status = "error";
      entry.error = err.message;
      writeManifest(manifest);
    }

    return NextResponse.json({ id: entry.id, status: entry.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
