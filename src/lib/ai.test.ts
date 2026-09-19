import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonOutput, parseScannedClues } from "./ai";

test("JSON output parser tolerates model commentary and code fences", () => {
  assert.deepEqual(parseJsonOutput("先分析。\n```json\n{\"ok\":true}\n```"), { ok: true });
});

test("scanned clue parser keeps complete entity cards", () => {
  assert.deepEqual(parseScannedClues('{"cards":[{"title":"匕首","content":"一把刀","sourceRef":"线索卡/004.jpg#1"}]}'), [
    { title: "匕首", content: "一把刀", sourceRef: "线索卡/004.jpg#1" },
  ]);
});
