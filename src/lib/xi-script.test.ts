import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { advancePhase, createGame, drawClue, type GameState, type ScriptPackage } from "./domain";

const recordPath = path.join(process.cwd(), "data", "scripts", "1c2ebff6-3566-4944-badf-2cdf6da45a7a.json");
const script = (JSON.parse(readFileSync(recordPath, "utf8")) as { script: ScriptPackage }).script;

test("Liangxi stored script preserves phase, deck, ending, and asset invariants", () => {
  assert.equal(script.id, "xi-liangxi-phantom");
  assert.equal(script.playerCount, 5);
  assert.equal(script.roles.length, 5);
  assert.deepEqual(script.phases.map((phase) => phase.id), ["opening", "round-one", "second-story", "round-two", "round-three", "final-vote"]);
  assert.deepEqual(Object.fromEntries(script.clueDecks.map((deck) => [deck.id, script.clues.filter((clue) => clue.deckId === deck.id).length])), {
    qingping: 10,
    hantang: 20,
    huoqi: 30,
    "deep-investigation": 10,
  });
  assert.deepEqual(Object.fromEntries(script.clueDecks.map((deck) => [deck.id, deck.drawLimitPerPlayer])), {
    qingping: 2,
    hantang: 4,
    huoqi: 6,
    "deep-investigation": 10,
  });
  assert.equal(script.endings.length, 5);
  assert.equal(script.clues.every((clue) => clue.content.trim() && clue.sourceRef && existsSync(path.join(process.cwd(), "public", clue.sourceRef))), true);
  assert.equal(script.roles.every((role) => role.privateBrief.includes(">>第一阶段故事<<") && role.privateBrief.includes(">>第二阶段故事<<") && role.sourcePages?.every((source) => existsSync(path.join(process.cwd(), "public", source)))), true);
});

test("Liangxi stored script completes all three search rounds without dead ends", () => {
  const rounds = [
    { phaseIndex: 1, deckId: "qingping", order: ["madam-lin", "lin-fengyu", "jiang-biyu", "han-jiaming", "lin-xue"] },
    { phaseIndex: 3, deckId: "hantang", order: ["lin-xue", "han-jiaming", "jiang-biyu", "lin-fengyu", "madam-lin"] },
    { phaseIndex: 4, deckId: "huoqi", order: script.roles.map((role) => role.id) },
  ];
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E"]), status: "playing", phaseIndex: 1 };
  for (const round of rounds) {
    game = { ...game, phaseIndex: round.phaseIndex };
    const deck = script.clueDecks.find((item) => item.id === round.deckId)!;
    for (const roleId of round.order) {
      const player = game.players.find((item) => item.roleId === roleId)!;
      for (let draw = 0; draw < deck.drawLimitPerPlayer; draw += 1) game = drawClue(script, game, player.id, deck.id);
    }
    assert.equal(game.players.every((player) => player.clueIds.filter((id) => script.clues.find((clue) => clue.id === id)?.deckId === deck.id).length === deck.drawLimitPerPlayer), true);
    game = advancePhase(script, game);
    if (round.phaseIndex === 1) game = advancePhase(script, game);
  }
  assert.equal(script.phases[game.phaseIndex].id, "final-vote");
});
