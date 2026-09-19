import { NextResponse } from "next/server";
import { getRoomSnapshot } from "@/lib/room-store";

export const runtime = "nodejs";

const tokenFrom = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const token = tokenFrom(request);
    if (!token) return NextResponse.json({ error: "缺少玩家凭据" }, { status: 401 });
    return NextResponse.json(await getRoomSnapshot(code, token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取房间失败";
    const status = message.includes("链接无效") ? 403 : message.includes("不存在") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
