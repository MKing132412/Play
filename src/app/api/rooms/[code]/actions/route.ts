import { NextResponse } from "next/server";
import { applyRoomAction, type RoomAction } from "@/lib/room-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!token) return NextResponse.json({ error: "缺少玩家凭据" }, { status: 401 });
    const action = await request.json() as RoomAction;
    return NextResponse.json(await applyRoomAction(code, token, action));
  } catch (error) {
    const message = error instanceof Error ? error.message : "房间操作失败";
    const status = message.includes("只有房主") || message.includes("链接无效") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
