import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { ScriptPackage } from "@/lib/domain";
import type { ImportManifest } from "@/lib/import-files";
import { createStoredScript, listStoredScripts, summarizeScript } from "@/lib/script-store";

export const runtime = "nodejs";

export async function GET() {
  const records = await listStoredScripts();
  return NextResponse.json({ scripts: records.map(summarizeScript) });
}

export async function POST(request: Request) {
  const body = await request.json() as { script?: ScriptPackage; manifest?: ImportManifest; sourceName?: string };
  if (!body.script || !body.manifest) return NextResponse.json({ error: "缺少剧本数据" }, { status: 400 });
  const fingerprint = `legacy-${createHash("sha256").update(JSON.stringify({ script: body.script, manifest: body.manifest })).digest("hex")}`;
  const stored = await createStoredScript({
    fingerprint,
    sourceName: body.sourceName?.trim() || body.script.title,
    script: body.script,
    manifest: body.manifest,
  });
  return NextResponse.json({ summary: summarizeScript(stored.record), reused: stored.reused }, { status: stored.reused ? 200 : 201 });
}
