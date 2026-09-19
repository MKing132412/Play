import { NextResponse } from "next/server";
import { validateScript, type ScriptPackage } from "@/lib/domain";
import { deleteStoredScript, getStoredScript, summarizeScript, updateStoredScript } from "@/lib/script-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getStoredScript(id);
  if (!record) return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
  return NextResponse.json({ record });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json() as { script?: ScriptPackage };
  if (!body.script) return NextResponse.json({ error: "缺少剧本数据" }, { status: 400 });
  const errors = validateScript(body.script).filter((issue) => issue.level === "error");
  if (errors.length) return NextResponse.json({ error: errors.map((issue) => issue.message).join("；") }, { status: 400 });
  const record = await updateStoredScript(id, body.script);
  if (!record) return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
  return NextResponse.json({ summary: summarizeScript(record) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await deleteStoredScript(id)) return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
  return new Response(null, { status: 204 });
}
