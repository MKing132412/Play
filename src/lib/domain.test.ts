import assert from "node:assert/strict";
import test from "node:test";
import { advancePhase, allVotesSubmitted, availableSpecialTriggers, clueCategory, clueChoiceError, createGame, drawClue, triggerSpecialClue, validateScript, visibleContext, type GameState, type ScriptPackage } from "./domain";
import { sampleScript } from "./sample";

test("script player count and role count agree", () => {
  const errors = validateScript(sampleScript).filter((issue) => issue.level === "error");
  assert.deepEqual(errors, []);
});

test("private DM context excludes truth and other players' clues", () => {
  let game = createGame(sampleScript, ["A", "B", "C", "D", "E", "F"]);
  game = { ...game, status: "playing", phaseIndex: 1 };
  game = drawClue(sampleScript, game, "player-1", "body");
  game = drawClue(sampleScript, game, "player-2", "ship");
  const context = visibleContext(sampleScript, game, "player-1");
  assert.equal("truth" in context, false);
  assert.equal(context.privateClues.length, 1);
  assert.equal(context.privateClues[0].deckId, "body");
});

test("draw limit is enforced", () => {
  let game = createGame(sampleScript, ["A", "B", "C", "D", "E", "F"]);
  game = { ...game, status: "playing", phaseIndex: 1 };
  game = drawClue(sampleScript, game, "player-1", "ship");
  assert.throws(() => drawClue(sampleScript, game, "player-1", "ship"), /次数已用完/);
});

test("targeted item search draws from another selected role", () => {
  const script: ScriptPackage = {
    ...sampleScript,
    clueDecks: [{ id: "personal-items", name: "角色随身物品", drawLimitPerPlayer: 1 }],
    clues: [
      { id: "item-a", title: `${sampleScript.roles[0].name}随身物品 · A`, content: "", deckId: "personal-items", availableFromPhase: sampleScript.phases[0].id, visibility: "private" },
      { id: "item-b", title: `${sampleScript.roles[1].name}随身物品 · B`, content: "", deckId: "personal-items", availableFromPhase: sampleScript.phases[0].id, visibility: "private" },
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing" };
  assert.throws(() => drawClue(script, game, "player-1", "personal-items", undefined, sampleScript.roles[0].id), /不能搜查自己的随身物品/);
  game = drawClue(script, game, "player-1", "personal-items", undefined, sampleScript.roles[1].id);
  assert.deepEqual(game.players[0].clueIds, ["item-b"]);
});

test("K2 room search requires a permitted explicit location", () => {
  const roles = sampleScript.roles.map((role, index) => ({ ...role, id: index === 0 ? "gray" : `role-${index}` }));
  const script: ScriptPackage = {
    ...sampleScript,
    id: "k2-dark-legend",
    roles,
    truth: { ...sampleScript.truth, culpritRoleId: roles[1].id },
    phases: [{ ...sampleScript.phases[0], id: "act-two" }],
    clueDecks: [
      { id: "personal-items", name: "随身物品", drawLimitPerPlayer: 1 },
      { id: "rooms", name: "房间线索", drawLimitPerPlayer: 1 },
    ],
    clues: [
      { id: "room-03", title: "地点三", content: "", deckId: "rooms", availableFromPhase: "act-two", visibility: "private" },
      { id: "room-06", title: "指定地点", content: "", deckId: "rooms", availableFromPhase: "act-two", visibility: "private" },
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing" };
  assert.throws(() => drawClue(script, game, "player-1", "personal-items"), /只能搜查地点线索/);
  assert.throws(() => drawClue(script, game, "player-1", "rooms"), /请选择要搜查的地点/);
  assert.throws(() => drawClue(script, game, "player-1", "rooms", undefined, undefined, "room-03"), /必须搜查指定地点/);
  game = drawClue(script, game, "player-1", "rooms", undefined, undefined, "room-06");
  assert.deepEqual(game.players[0].clueIds, ["room-06"]);
});

test("K2 role-specific forbidden rooms match the role books", () => {
  const script: ScriptPackage = { ...sampleScript, id: "k2-dark-legend", phases: [{ ...sampleScript.phases[0], id: "act-two" }] };
  const game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing" };
  const forbidden = { werewolf: "room-05", count: "room-03", "bai-suzhen": "room-02", scissorhands: "room-04", emily: "room-07" };
  for (const [roleId, clueId] of Object.entries(forbidden)) {
    assert.match(clueChoiceError(script, game, { id: roleId, name: roleId, roleId, clueIds: [], ready: true }, { id: clueId, title: clueId, content: "", deckId: "rooms", availableFromPhase: "act-two", visibility: "private" }), /不能搜查/);
  }
});

test("K2 Leader is registered before item search and cannot draw", () => {
  const roles = sampleScript.roles.map((role, index) => ({ ...role, id: `k2-role-${index}` }));
  const script: ScriptPackage = {
    ...sampleScript,
    id: "k2-dark-legend",
    roles,
    truth: { ...sampleScript.truth, culpritRoleId: roles[1].id },
    phases: [{ ...sampleScript.phases[0], id: "act-one" }],
    clueDecks: [{ id: "personal-items", name: "角色随身物品", drawLimitPerPlayer: 1 }],
    clues: roles.map((role, index) => ({ id: `item-${index}`, title: `${role.name}随身物品 · 物品`, content: "", deckId: "personal-items", availableFromPhase: "act-one", visibility: "private" })),
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing" };
  assert.throws(() => drawClue(script, game, "player-2", "personal-items", undefined, roles[2].id), /登记 Leader/);
  game = { ...game, leaderPlayerId: "player-1" };
  assert.throws(() => drawClue(script, game, "player-1", "personal-items", undefined, roles[2].id), /Leader 不参与/);
  game = drawClue(script, game, "player-2", "personal-items", undefined, roles[2].id);
  assert.equal(game.players[1].clueIds.length, 1);
});

test("first host advance starts phase one instead of skipping it", () => {
  const game = createGame(sampleScript, ["A", "B", "C", "D", "E", "F"]);
  const started = advancePhase(sampleScript, game);
  assert.equal(started.status, "playing");
  assert.equal(started.phaseIndex, 0);
});

test("K1 clue categories and phase quotas are enforced", () => {
  const script: ScriptPackage = {
    ...sampleScript,
    phases: [
      { ...sampleScript.phases[0], id: "banquet" },
      { ...sampleScript.phases[1], id: "evidence" },
      { ...sampleScript.phases[2], id: "final-evidence" },
      { ...sampleScript.phases[3], id: "final-vote" },
    ],
    clueDecks: [{ id: "all", name: "全部线索", drawLimitPerPlayer: 8 }],
    clues: [
      ...Array.from({ length: 3 }, (_, index) => ({ id: `role-${index}`, title: `角色的随身物品${index}`, content: "", deckId: "all", availableFromPhase: "evidence" as const, visibility: "private" as const })),
      ...Array.from({ length: 6 }, (_, index) => ({ id: `ship-${index}`, title: `甲板线索${index}`, content: "", deckId: "all", availableFromPhase: "evidence" as const, visibility: "private" as const })),
      ...Array.from({ length: 2 }, (_, index) => ({ id: `body-${index}`, title: `尸体线索${index}`, content: "", deckId: "all", availableFromPhase: "evidence" as const, visibility: "private" as const })),
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing", phaseIndex: 1 };
  game = drawClue(script, game, "player-1", "all", "role");
  for (let count = 0; count < 3; count += 1) game = drawClue(script, game, "player-1", "all", "ship");
  assert.throws(() => drawClue(script, game, "player-1", "all", "role"), /该类线索已抽完/);
  assert.throws(() => drawClue(script, game, "player-1", "all", "body"), /该类线索已抽完/);
  game = { ...game, phaseIndex: 2 };
  game = drawClue(script, game, "player-1", "all", "role");
  game = drawClue(script, game, "player-1", "all", "body");
  for (let count = 0; count < 2; count += 1) game = drawClue(script, game, "player-1", "all", "ship");
  assert.equal(game.players[0].clueIds.length, 8);
  assert.equal(clueCategory(script.clues.find((clue) => clue.id === game.players[0].clueIds.at(-1))!), "ship");
});

test("all votes are required before final completion", () => {
  const game = createGame(sampleScript, ["A", "B", "C", "D", "E", "F"]);
  assert.equal(allVotesSubmitted(game), false);
  assert.equal(allVotesSubmitted({ ...game, players: game.players.map((player) => ({ ...player, voteRoleId: sampleScript.roles[0].id })) }), true);
});

test("memory cards are special clues and stay outside random role draws", () => {
  assert.equal(clueCategory({ title: "玉佩的记忆" }), "special");
  assert.equal(clueCategory({ title: "娃娃的记忆" }), "special");
  assert.equal(clueCategory({ title: "安乡的随身物品1" }), "role");
});

test("K1 special clues require matching holders and are granted to both participants", () => {
  const script: ScriptPackage = {
    ...sampleScript,
    id: "k1-cruise-shadow",
    phases: [
      { ...sampleScript.phases[0], id: "banquet" },
      { ...sampleScript.phases[1], id: "evidence" },
      { ...sampleScript.phases[2], id: "final-evidence" },
      { ...sampleScript.phases[3], id: "final-vote" },
    ],
    clueDecks: [{ id: "all", name: "全部线索", drawLimitPerPlayer: 8 }],
    clues: [
      { id: "scan-clue-1", title: "玉佩的记忆", content: "memory", deckId: "all", availableFromPhase: "evidence", visibility: "private" },
      { id: "scan-clue-3", title: "秋宏的随身物品1", content: "key-a", deckId: "all", availableFromPhase: "evidence", visibility: "private" },
      { id: "scan-clue-12", title: "安记者的随身物品3", content: "key-b", deckId: "all", availableFromPhase: "evidence", visibility: "private" },
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E", "F"]), status: "playing", phaseIndex: 2 };
  game = { ...game, players: game.players.map((player, index) => index === 0 ? { ...player, clueIds: ["scan-clue-3"] } : index === 1 ? { ...player, clueIds: ["scan-clue-12"] } : player) };
  assert.deepEqual(availableSpecialTriggers(script, game, "player-1").map((item) => item.clueId), ["scan-clue-1"]);
  game = triggerSpecialClue(script, game, "player-1", "scan-clue-1");
  assert.equal(game.players[0].clueIds.includes("scan-clue-1"), true);
  assert.equal(game.players[1].clueIds.includes("scan-clue-1"), true);
  assert.deepEqual(availableSpecialTriggers(script, game, "player-1"), []);
  assert.throws(() => drawClue(script, game, "player-1", "all", undefined, undefined, "scan-clue-1"), /特殊线索必须/);
});

test("Liangxi rounds enforce deck, own-search exclusion, public clues, and targeted deep clues", () => {
  const roles = ["han-jiaming", "jiang-biyu", "lin-fengyu", "madam-lin", "lin-xue"].map((id) => ({ id, name: id === "han-jiaming" ? "韩家明" : id, publicBio: "", privateBrief: "", objectives: [] }));
  const script: ScriptPackage = {
    ...sampleScript,
    id: "xi-liangxi-phantom",
    playerCount: 5,
    roles,
    truth: { ...sampleScript.truth, culpritRoleId: roles[0].id },
    phases: [{ ...sampleScript.phases[0], id: "round-one", allowedActions: ["search"] }],
    clueDecks: [
      { id: "qingping", name: "青萍之末", drawLimitPerPlayer: 2 },
      { id: "hantang", name: "寒塘鹤影", drawLimitPerPlayer: 4 },
      { id: "deep-investigation", name: "曲径通幽", drawLimitPerPlayer: 10 },
    ],
    clues: [
      { id: "own", title: "青萍之末 · 韩家明搜身线索", content: "", deckId: "qingping", availableFromPhase: "round-one", visibility: "private" },
      { id: "public", title: "青萍之末 · 公开", content: "", deckId: "qingping", availableFromPhase: "round-one", visibility: "public" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `neutral-${index}`, title: `青萍之末 · ${index}`, content: "", deckId: "qingping", availableFromPhase: "round-one", visibility: "private" as const })),
      { id: "later", title: "寒塘鹤影", content: "", deckId: "hantang", availableFromPhase: "round-one", visibility: "private" },
      { id: "deep-01", title: "曲径通幽 · 01", content: "", deckId: "deep-investigation", availableFromPhase: "round-one", visibility: "public" },
      { id: "clue-13", title: "前置 13", content: "", deckId: "deep-investigation", availableFromPhase: "round-one", visibility: "private" },
      { id: "clue-41", title: "前置 41", content: "", deckId: "deep-investigation", availableFromPhase: "round-one", visibility: "private" },
      ...Object.entries({ "deep-06": "lin-xue", "deep-07": "lin-fengyu", "deep-08": "jiang-biyu", "deep-09": "madam-lin", "deep-10": "han-jiaming" }).map(([id, owner]) => ({ id, title: `${owner}专属`, content: "", deckId: "deep-investigation", availableFromPhase: "round-one", visibility: "private" as const })),
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E"]), status: "playing" };
  game = { ...game, players: game.players.map((player, index) => index === 1 ? { ...player, clueIds: ["neutral-0", "neutral-1"] } : index === 2 ? { ...player, clueIds: ["neutral-2", "neutral-3"] } : index === 3 ? { ...player, clueIds: ["neutral-4", "neutral-5"] } : player) };
  assert.throws(() => drawClue(script, game, "player-1", "hantang"), /当前阶段不能抽取/);
  assert.throws(() => drawClue(script, game, "player-1", "qingping", undefined, undefined, "own"), /当前没有可抽取/);
  game = drawClue(script, game, "player-1", "qingping", undefined, undefined, "public");
  assert.deepEqual(game.players[0].clueIds, ["public"]);
  assert.deepEqual(game.publicClueIds, ["public"]);
  assert.throws(() => drawClue(script, game, "player-1", "deep-investigation"), /请选择卡面指引/);
  assert.throws(() => drawClue(script, game, "player-1", "deep-investigation", undefined, undefined, "deep-06"), /自动发放/);
  game = { ...game, players: game.players.map((player, index) => index === 0 ? { ...player, clueIds: [...player.clueIds, "clue-13"] } : index === 1 ? { ...player, clueIds: ["clue-41"] } : player) };
  game = drawClue(script, game, "player-1", "deep-investigation", undefined, undefined, "deep-01");
  assert.equal(game.publicClueIds.includes("deep-01"), true);
  assert.equal(game.players.every((player) => player.clueIds.some((id) => id.startsWith("deep-"))), true);
});

test("Liangxi fixed draw order and round completion are enforced", () => {
  const roles = [
    { id: "han-jiaming", name: "韩家明" },
    { id: "jiang-biyu", name: "江碧玉" },
    { id: "lin-fengyu", name: "林凤羽" },
    { id: "madam-lin", name: "林夫人" },
    { id: "lin-xue", name: "林雪" },
  ].map((role) => ({ ...role, publicBio: "", privateBrief: "", objectives: [] }));
  const script: ScriptPackage = {
    ...sampleScript,
    id: "xi-liangxi-phantom",
    playerCount: 5,
    roles,
    truth: { ...sampleScript.truth, culpritRoleId: "han-jiaming" },
    phases: [
      { ...sampleScript.phases[0], id: "opening" },
      { ...sampleScript.phases[1], id: "round-one" },
      { ...sampleScript.phases[2], id: "second-story" },
      { ...sampleScript.phases[2], id: "round-two" },
      { ...sampleScript.phases[2], id: "round-three" },
      { ...sampleScript.phases[3], id: "final-vote" },
    ],
    clueDecks: [{ id: "qingping", name: "青萍之末", drawLimitPerPlayer: 2 }],
    clues: Array.from({ length: 10 }, (_, index) => ({ id: `q-${index}`, title: `线索 ${index}`, content: "", deckId: "qingping", availableFromPhase: "round-one", visibility: "private" as const })),
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E"]), status: "playing", phaseIndex: 1 };
  assert.throws(() => drawClue(script, game, "player-1", "qingping"), /等待林夫人/);
  game = drawClue(script, game, "player-4", "qingping");
  assert.throws(() => drawClue(script, game, "player-3", "qingping"), /等待林夫人/);
  assert.throws(() => advancePhase(script, game), /尚未完成本轮搜证/);
});

test("Liangxi deep investigations require source cards and dedicated clues cannot be selected", () => {
  const roles = ["han-jiaming", "jiang-biyu", "lin-fengyu", "madam-lin", "lin-xue"].map((id) => ({ id, name: id, publicBio: "", privateBrief: "", objectives: [] }));
  const script: ScriptPackage = {
    ...sampleScript,
    id: "xi-liangxi-phantom",
    playerCount: 5,
    roles,
    truth: { ...sampleScript.truth, culpritRoleId: "han-jiaming" },
    phases: [{ ...sampleScript.phases[0], id: "round-three" }],
    clueDecks: [{ id: "deep-investigation", name: "曲径通幽", drawLimitPerPlayer: 10 }],
    clues: [
      { id: "clue-13", title: "前置 A", content: "", deckId: "deep-investigation", availableFromPhase: "round-three", visibility: "private" },
      { id: "clue-41", title: "前置 B", content: "", deckId: "deep-investigation", availableFromPhase: "round-three", visibility: "private" },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `deep-${String(index + 1).padStart(2, "0")}`, title: `深入 ${index + 1}`, content: "", deckId: "deep-investigation", availableFromPhase: "round-three", visibility: "private" as const })),
    ],
  };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E"]), status: "playing" };
  assert.match(clueChoiceError(script, game, game.players[0], script.clues.find((clue) => clue.id === "deep-01")!), /前置线索/);
  assert.match(clueChoiceError(script, game, game.players[4], script.clues.find((clue) => clue.id === "deep-06")!), /自动发放/);
  game = { ...game, players: game.players.map((player, index) => index === 0 ? { ...player, clueIds: ["clue-13"] } : index === 1 ? { ...player, clueIds: ["clue-41"] } : player) };
  assert.equal(clueChoiceError(script, game, game.players[0], script.clues.find((clue) => clue.id === "deep-01")!), "");
});

test("Liangxi DM context omits unopened story, tasks, and source pages", () => {
  const roles = ["han-jiaming", "jiang-biyu", "lin-fengyu", "madam-lin", "lin-xue"].map((id) => ({
    id,
    name: id,
    publicBio: "",
    privateBrief: ">>第一阶段故事<<\nFIRST\n\n>>第二阶段故事<<\nSECOND\n\n*游戏流程*\n>>开场讨论<<\nOPEN\n\n>>第一轮搜证与讨论<<\nROUND_ONE\n\n>>第二阶段公开讨论<<\nSTAGE_TWO",
    objectives: ["LATE_TASK"],
    sourcePages: Array.from({ length: 18 }, (_, index) => `/page-${index + 1}.webp`),
  }));
  const script: ScriptPackage = { ...sampleScript, id: "xi-liangxi-phantom", playerCount: 5, roles, truth: { ...sampleScript.truth, culpritRoleId: roles[0].id } };
  let game: GameState = { ...createGame(script, ["A", "B", "C", "D", "E"]), status: "playing" };
  const opening = visibleContext(script, game, "player-1").role!;
  assert.match(opening.privateBrief, /FIRST/);
  assert.doesNotMatch(opening.privateBrief, /SECOND|ROUND_ONE|STAGE_TWO/);
  assert.deepEqual(opening.objectives, []);
  assert.equal(opening.sourcePages?.length, 13);
  game = { ...game, phaseIndex: 2 };
  const second = visibleContext(script, game, "player-1").role!;
  assert.match(second.privateBrief, /SECOND|STAGE_TWO/);
  assert.deepEqual(second.objectives, ["LATE_TASK"]);
  assert.equal(second.sourcePages?.length, 18);
});
