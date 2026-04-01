import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(process.cwd(), "..", "..", "data", "uploads", "manifest.json");

export async function GET() {
  if (!existsSync(MANIFEST_PATH)) {
    return NextResponse.json([]);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  return NextResponse.json(manifest);
}
