import OpenAI from "openai";

export function getAiClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
}

export const aiModel = () => process.env.DEEPSEEK_MODEL || "deepseek-flash";
export const aiVisionModel = () => process.env.DEEPSEEK_VISION_MODEL || aiModel();

export function responseText(response: { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }) {
  return response.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("") ?? "";
}

export function parseJsonOutput<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const starts = [...cleaned.matchAll(/\{/g)].map((match) => match.index);
    const ends = [...cleaned.matchAll(/\}/g)].map((match) => match.index).reverse();
    for (const start of starts) {
      for (const end of ends) {
        if (end <= start) continue;
        try {
          return JSON.parse(cleaned.slice(start, end + 1)) as T;
        } catch {
          // Try the next balanced-looking region emitted after model commentary.
        }
      }
    }
    throw new Error("模型未返回可解析的剧本 JSON");
  }
}

export type ScannedClue = { title: string; content: string; sourceRef: string };

export function parseScannedClues(text: string): ScannedClue[] {
  const result = parseJsonOutput<{ cards?: ScannedClue[] }>(text);
  return (result.cards ?? []).filter((card) => card.title?.trim() && card.content?.trim() && card.sourceRef?.trim());
}
