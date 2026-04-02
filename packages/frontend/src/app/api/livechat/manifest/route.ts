import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "..", "..", "data");
const UPLOADS_DIR = join(DATA_DIR, "uploads");
const OUTPUT_DIR = join(DATA_DIR, "output");
const MANIFEST_PATH = join(UPLOADS_DIR, "manifest.json");

function readManifest(): any[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

export async function GET() {
  return NextResponse.json(readManifest());
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const manifest = readManifest();
  const entry = manifest.find((e: any) => e.id === id);
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove output files
  if (entry.outputFiles) {
    for (const filePath of Object.values(entry.outputFiles) as string[]) {
      try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  // Remove uploaded CSV
  const csvPath = join(UPLOADS_DIR, `${id}.csv`);
  try { if (existsSync(csvPath)) unlinkSync(csvPath); } catch { /* ignore */ }

  // Update manifest
  const updated = manifest.filter((e: any) => e.id !== id);
  writeFileSync(MANIFEST_PATH, JSON.stringify(updated, null, 2));

  return NextResponse.json({ ok: true });
}
