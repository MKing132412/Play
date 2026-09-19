import { NextResponse } from "next/server";
import { aiModel, getAiClient, responseText } from "@/lib/ai";
import { getRoomDmContext } from "@/lib/room-store";

export async function POST(request: Request) {
  const body = await request.json() as { question?: string; context?: unknown; roomCode?: string; token?: string };
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "请输入问题" }, { status: 400 });
  let dmContext = body.context;
  if (body.roomCode && body.token) {
    try {
      dmContext = (await getRoomDmContext(body.roomCode, body.token)).context;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "玩家凭据无效" }, { status: 403 });
    }
  }

  const client = getAiClient();
  if (!client) {
    const answer = question.includes("搜证")
      ? "请查看当前阶段允许的操作。进入搜证阶段后，每个牌组会显示你的剩余次数。"
      : question.includes("公开")
        ? "只有点击“公开线索”后，其他玩家才会在公共记录中看到内容。口头交流不会自动改变网站状态。"
        : "我会依据你当前可见的角色密档、私人线索与公共记录回答。当前为演示模式，关键裁定请交给房主。";
    return NextResponse.json({ answer, mode: "demo" });
  }

  try {
    const response = await client.responses.create({
      model: aiModel(),
      instructions: "你是克制、公平的剧本杀 DM。只使用给定的玩家可见上下文回答，不推测未提供的事实，不泄露答案。deckStatus 是搜证次数的唯一事实来源；remaining 为 0 或 available 为 false 时不得说还能从该牌组搜证。操作类请求只说明网站中的正确操作，不声称已经修改游戏状态。用简洁中文回答。",
      input: `玩家可见上下文：\n${JSON.stringify(dmContext)}\n\n玩家问题：${question}`,
      reasoning: { effort: "none" },
      store: false,
    });
    return NextResponse.json({ answer: responseText(response), mode: "ai" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DM 暂时没有回应";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
