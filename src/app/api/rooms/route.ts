import { NextResponse } from "next/server";
import { validateScript, type ScriptPackage } from "@/lib/domain";
import { createOnlineRoom } from "@/lib/room-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { script?: ScriptPackage; origin?: string };
    if (!body.script) return NextResponse.json({ error: "缺少剧本数据" }, { status: 400 });
    const errors = validateScript(body.script).filter((issue) => issue.level === "error");
    if (errors.length) return NextResponse.json({ error: errors.map((issue) => issue.message).join("；") }, { status: 400 });
    let origin = new URL(request.url).origin;
    if (body.origin) {
      const candidate = new URL(body.origin);
      if ((candidate.protocol === "http:" || candidate.protocol === "https:") && candidate.host === request.headers.get("host")) origin = candidate.origin;
    }
    const result = await createOnlineRoom(body.script, origin);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建房间失败" }, { status: 500 });
  }
}
