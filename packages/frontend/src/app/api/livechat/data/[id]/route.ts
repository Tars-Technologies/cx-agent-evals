import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(process.cwd(), "..", "..", "data", "uploads", "manifest.json");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type"); // "rawTranscripts" | "microtopics" | "basicStats"

  if (!type || !["rawTranscripts", "microtopics", "basicStats"].includes(type)) {
    return NextResponse.json({ error: "Missing or invalid type param" }, { status: 400 });
  }

  if (!existsSync(MANIFEST_PATH)) {
    return NextResponse.json({ error: "No manifest" }, { status: 404 });
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const entry = manifest.find((e: any) => e.id === id);

  if (!entry || entry.status !== "ready" || !entry.outputFiles) {
    return NextResponse.json({ error: "Upload not ready" }, { status: 404 });
  }

  const filePath = entry.outputFiles[type as keyof typeof entry.outputFiles];
  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  return NextResponse.json(data);
}
