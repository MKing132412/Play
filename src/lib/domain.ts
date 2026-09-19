export type Confidence = "high" | "medium" | "low";

export type Role = {
  id: string;
  name: string;
  publicBio: string;
  privateBrief: string;
  objectives: string[];
  sourcePages?: string[];
};

export type Phase = {
  id: string;
  name: string;
  objective: string;
  hostPrompt: string;
  allowedActions: Array<"read" | "search" | "discuss" | "vote">;
  durationMinutes: number;
};

export type Clue = {
  id: string;
  title: string;
  content: string;
  deckId: string;
  availableFromPhase: string;
  visibility: "private" | "public";
  sourceRef?: string;
};

export type ClueCategory = "role" | "ship" | "body" | "special";

export type ClueDeck = {
  id: string;
  name: string;
  drawLimitPerPlayer: number;
};

export type ScriptPackage = {
  id: string;
  title: string;
  synopsis: string;
  playerCount: number;
  estimatedMinutes: number;
  roles: Role[];
  phases: Phase[];
  clueDecks: ClueDeck[];
  clues: Clue[];
  truth: {
    culpritRoleId: string;
    method: string;
    motive: string;
    timeline: string[];
  };
  endings: Array<{ id: string; condition: "solved" | "escaped" | "framed"; title: string; text: string }>;
  review: Array<{ path: string; confidence: Confidence; note: string }>;
};

export type PlayerState = {
  id: string;
  name: string;
  roleId: string;
  clueIds: string[];
  ready: boolean;
  voteRoleId?: string;
};

export type GameState = {
  roomCode: string;
  status: "lobby" | "playing" | "finished";
  phaseIndex: number;
  players: PlayerState[];
  publicClueIds: string[];
  eventLog: string[];
  leaderPlayerId?: string;
  actOneAccusationRoleId?: string;
};

export type ReviewIssue = { level: "error" | "warning"; message: string };

export type SpecialTrigger = { clueId: string; title: string; requiredClueIds: string[] };

const k1SpecialTriggerRules: SpecialTrigger[] = [
  { clueId: "scan-clue-1", title: "玉佩的记忆", requiredClueIds: ["scan-clue-3", "scan-clue-12"] },
  { clueId: "scan-clue-2", title: "娃娃的记忆", requiredClueIds: ["scan-clue-10", "scan-clue-14"] },
];

export function availableSpecialTriggers(script: ScriptPackage, state: GameState, playerId: string): SpecialTrigger[] {
  if (script.id !== "k1-cruise-shadow" || script.phases[state.phaseIndex]?.id !== "final-evidence") return [];
  const owned = new Set(state.players.flatMap((player) => player.clueIds));
  return k1SpecialTriggerRules.filter((rule) => !owned.has(rule.clueId) && rule.requiredClueIds.every((id) => owned.has(id)) && rule.requiredClueIds.some((id) => state.players.find((player) => player.id === playerId)?.clueIds.includes(id)));
}

export function triggerSpecialClue(script: ScriptPackage, state: GameState, playerId: string, clueId: string): GameState {
  const rule = availableSpecialTriggers(script, state, playerId).find((item) => item.clueId === clueId);
  if (!rule) throw new Error("当前没有满足条件的特殊线索联动");
  const recipients = state.players.filter((player) => rule.requiredClueIds.some((id) => player.clueIds.includes(id))).map((player) => player.id);
  return {
    ...state,
    players: state.players.map((player) => recipients.includes(player.id) && !player.clueIds.includes(clueId) ? { ...player, clueIds: [...player.clueIds, clueId] } : player),
    eventLog: [...state.eventLog, `${state.players.find((player) => player.id === playerId)?.name ?? "玩家"} 触发了特殊线索“${rule.title}”`],
  };
}

export function clueCategory(clue: Pick<Clue, "title">): ClueCategory {
  if (clue.title === "玉佩的记忆" || clue.title === "娃娃的记忆") return "special";
  if (clue.title.startsWith("尸体线索")) return "body";
  if (clue.title.includes("随身物品")) return "role";
  return "ship";
}

export function clueQuota(category: ClueCategory, phaseIndex: number) {
  if (phaseIndex === 1) return { role: 1, ship: 3, body: 0, special: 0 }[category];
  if (phaseIndex === 2) return { role: 1, ship: 2, body: 1, special: 0 }[category];
  return 0;
}

export function clueTarget(category: ClueCategory, phaseIndex: number) {
  return phaseIndex >= 2 ? clueQuota(category, 1) + clueQuota(category, 2) : clueQuota(category, phaseIndex);
}

export function allVotesSubmitted(state: GameState) {
  return state.players.length > 0 && state.players.every((player) => Boolean(player.voteRoleId));
}

const unique = (values: string[]) => new Set(values).size === values.length;

export function validateScript(script: ScriptPackage): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (script.roles.length !== script.playerCount) {
    issues.push({ level: "error", message: `人数为 ${script.playerCount}，但识别到 ${script.roles.length} 个角色` });
  }
  if (!unique(script.roles.map((role) => role.id))) {
    issues.push({ level: "error", message: "角色 ID 存在重复" });
  }
  if (!script.roles.some((role) => role.id === script.truth.culpritRoleId)) {
    issues.push({ level: "error", message: "真相中的凶手不在角色列表中" });
  }
  if (script.phases.length === 0) {
    issues.push({ level: "error", message: "未识别到游戏阶段" });
  }
  const phaseIds = new Set(script.phases.map((phase) => phase.id));
  const deckIds = new Set(script.clueDecks.map((deck) => deck.id));
  if (!unique(script.clues.map((clue) => clue.id))) {
    issues.push({ level: "error", message: "线索 ID 存在重复" });
  }
  for (const clue of script.clues) {
    if (!phaseIds.has(clue.availableFromPhase)) {
      issues.push({ level: "error", message: `线索“${clue.title}”引用了不存在的阶段` });
    }
    if (!deckIds.has(clue.deckId)) {
      issues.push({ level: "error", message: `线索“${clue.title}”引用了不存在的牌组` });
    }
  }
  if (script.review.some((item) => item.confidence === "low")) {
    issues.push({ level: "warning", message: "关键字段含低置信度结果，发布前需要人工确认" });
  }
  return issues;
}

export function createGame(script: ScriptPackage, names: string[]): GameState {
  if (names.length !== script.playerCount) throw new Error(`需要 ${script.playerCount} 名玩家`);
  return {
    roomCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
    status: "lobby",
    phaseIndex: 0,
    players: names.map((name, index) => ({
      id: `player-${index + 1}`,
      name,
      roleId: script.roles[index].id,
      clueIds: [],
      ready: false,
    })),
    publicClueIds: [],
    eventLog: ["房间已创建，等待玩家确认角色"],
  };
}

const k2ForbiddenRoomByRole: Record<string, string> = {
  werewolf: "room-05",
  count: "room-03",
  "bai-suzhen": "room-02",
  scissorhands: "room-04",
  emily: "room-07",
};

const xiDeckByPhase: Record<string, string> = {
  "round-one": "qingping",
  "round-two": "hantang",
  "round-three": "huoqi",
};

const xiDeepClueOwner: Record<string, string> = {
  "deep-06": "lin-xue",
  "deep-07": "lin-fengyu",
  "deep-08": "jiang-biyu",
  "deep-09": "madam-lin",
  "deep-10": "han-jiaming",
};

function xiClueAllowedForPlayer(script: ScriptPackage, player: PlayerState, clue: Clue) {
  const roleName = script.roles.find((role) => role.id === player.roleId)?.name;
  return !roleName || !clue.title.includes(`${roleName}搜身线索`);
}

function xiDeckRemainsAllocatable(script: ScriptPackage, state: GameState, deck: ClueDeck, playerId: string, chosenClueId: string) {
  const owned = new Set([...state.players.flatMap((player) => player.clueIds), chosenClueId]);
  const slots = state.players.flatMap((player) => {
    const drawn = player.clueIds.filter((id) => script.clues.find((clue) => clue.id === id)?.deckId === deck.id).length + (player.id === playerId ? 1 : 0);
    return Array.from({ length: Math.max(0, deck.drawLimitPerPlayer - drawn) }, () => player);
  });
  const remaining = script.clues.filter((clue) => clue.deckId === deck.id && !owned.has(clue.id));
  if (remaining.length < slots.length) return false;
  const cardForSlot = new Array<number>(slots.length).fill(-1);
  const assign = (cardIndex: number, seen: Set<number>): boolean => {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (seen.has(slotIndex) || !xiClueAllowedForPlayer(script, slots[slotIndex], remaining[cardIndex])) continue;
      seen.add(slotIndex);
      if (cardForSlot[slotIndex] < 0 || assign(cardForSlot[slotIndex], seen)) {
        cardForSlot[slotIndex] = cardIndex;
        return true;
      }
    }
    return false;
  };
  return remaining.every((_, cardIndex) => assign(cardIndex, new Set())) || cardForSlot.filter((index) => index >= 0).length === slots.length;
}

export function clueChoiceError(script: ScriptPackage, state: GameState, player: PlayerState, clue: Clue) {
  if (script.id === "xi-liangxi-phantom" && clue.deckId === "deep-investigation") {
    const owner = xiDeepClueOwner[clue.id];
    if (owner && owner !== player.roleId) return "这张深入调查线索属于其他角色";
    return "";
  }
  if (script.id !== "k2-dark-legend" || script.phases[state.phaseIndex]?.id !== "act-two" || clue.deckId !== "rooms") return "";
  if (player.roleId === "gray" && clue.id !== "room-06") return "该角色本轮必须搜查指定地点";
  if (k2ForbiddenRoomByRole[player.roleId] === clue.id) return "角色密档规定你不能搜查这个地点";
  return "";
}

export function drawClue(script: ScriptPackage, state: GameState, playerId: string, deckId: string, requestedCategory?: ClueCategory, targetRoleId?: string, targetClueId?: string): GameState {
  const player = state.players.find((item) => item.id === playerId);
  const deck = script.clueDecks.find((item) => item.id === deckId);
  if (!player || !deck) throw new Error("玩家或线索牌组不存在");
  const targetRole = targetRoleId ? script.roles.find((role) => role.id === targetRoleId) : undefined;
  if (targetRoleId && !targetRole) throw new Error("搜查对象不存在");
  if (deckId === "personal-items" && targetRoleId === player.roleId) throw new Error("不能搜查自己的随身物品");
  if (script.id === "k2-dark-legend" && script.phases[state.phaseIndex]?.id === "act-one" && deckId === "personal-items") {
    if (!state.leaderPlayerId) throw new Error("请先由房主登记 Leader");
    if (state.leaderPlayerId === player.id) throw new Error("Leader 不参与本轮搜查");
  }
  const targetClue = targetClueId ? script.clues.find((clue) => clue.id === targetClueId && clue.deckId === deckId) : undefined;
  if (targetClueId && !targetClue) throw new Error("搜查地点不存在");
  if (targetClue && script.id === "k1-cruise-shadow" && clueCategory(targetClue) === "special") throw new Error("特殊线索必须满足条件后联动触发");
  if (script.id === "xi-liangxi-phantom") {
    const phaseDeck = xiDeckByPhase[script.phases[state.phaseIndex]?.id];
    if (deckId !== phaseDeck && deckId !== "deep-investigation") throw new Error("当前阶段不能抽取这组线索");
    if (deckId === "deep-investigation" && !targetClue) throw new Error("请选择卡面指引指定的深入调查编号");
  }
  if (script.id === "k2-dark-legend" && script.phases[state.phaseIndex]?.id === "act-two" && deckId !== "rooms") throw new Error("当前阶段只能搜查地点线索");
  if (script.id === "k2-dark-legend" && script.phases[state.phaseIndex]?.id === "act-two" && deckId === "rooms" && !targetClue) throw new Error("请选择要搜查的地点");
  if (targetClue) {
    const choiceError = clueChoiceError(script, state, player, targetClue);
    if (choiceError) throw new Error(choiceError);
  }
  const allowedPhaseIds = new Set(script.phases.slice(0, state.phaseIndex + 1).map((phase) => phase.id));
  const owned = new Set(state.players.flatMap((item) => item.clueIds));
  const category = requestedCategory;
  const ownedInCategory = player.clueIds.filter((id) => {
    const clue = script.clues.find((item) => item.id === id);
    return clue && (!category || clueCategory(clue) === category);
  }).length;
  if (category) {
    const target = clueTarget(category, state.phaseIndex);
    if (ownedInCategory >= target) throw new Error("本阶段该类线索已抽完");
  } else {
    const drawnInDeck = player.clueIds.filter((id) => script.clues.find((clue) => clue.id === id)?.deckId === deckId).length;
    if (drawnInDeck >= deck.drawLimitPerPlayer) throw new Error("本轮搜证次数已用完");
  }
  const candidates = script.clues.filter((item) => item.deckId === deckId && allowedPhaseIds.has(item.availableFromPhase) && !owned.has(item.id) && (!category || clueCategory(item) === category) && (!targetRole || item.title.startsWith(`${targetRole.name}随身物品`)) && (!targetClue || item.id === targetClue.id) && !(script.id === "xi-liangxi-phantom" && !xiClueAllowedForPlayer(script, player, item)));
  const allocatableCandidates = script.id === "xi-liangxi-phantom" && deckId !== "deep-investigation" ? candidates.filter((item) => xiDeckRemainsAllocatable(script, state, deck, playerId, item.id)) : candidates;
  const clue = allocatableCandidates[Math.floor(Math.random() * allocatableCandidates.length)];
  if (!clue) throw new Error("当前没有可抽取线索");
  if (script.id === "xi-liangxi-phantom" && clue.id === "deep-01") {
    const assigned = new Map(Object.entries(xiDeepClueOwner).map(([clueId, roleId]) => [roleId, clueId]));
    return {
      ...state,
      players: state.players.map((item) => {
        const roleClueId = assigned.get(item.roleId);
        const additions = [...(item.id === playerId ? [clue.id] : []), ...(roleClueId && !owned.has(roleClueId) ? [roleClueId] : [])];
        return additions.length ? { ...item, clueIds: [...item.clueIds, ...additions] } : item;
      }),
      publicClueIds: [...new Set([...state.publicClueIds, clue.id])],
      eventLog: [...state.eventLog, `${player.name} 开启了林府密道，五名角色分别获得一张专属深入调查线索`],
    };
  }
  return {
    ...state,
    players: state.players.map((item) => item.id === playerId ? { ...item, clueIds: [...item.clueIds, clue.id] } : item),
    publicClueIds: clue.visibility === "public" ? [...new Set([...state.publicClueIds, clue.id])] : state.publicClueIds,
    eventLog: [...state.eventLog, targetRole ? `${player.name} 搜查了 ${targetRole.name} 的随身物品` : targetClue ? `${player.name} 选择搜查了${targetClue.title}` : `${player.name} 从“${deck.name}”随机获得了${category ? ({ role: "角色随身物品", ship: "轮船", body: "尸体", special: "特殊" }[category]) : "一条"}线索`],
  };
}

export function visibleContext(script: ScriptPackage, state: GameState, playerId: string) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) throw new Error("玩家不存在");
  const role = script.roles.find((item) => item.id === player.roleId);
  return {
    phase: script.phases[state.phaseIndex],
    role,
    privateClues: script.clues.filter((clue) => player.clueIds.includes(clue.id)),
    publicClues: script.clues.filter((clue) => state.publicClueIds.includes(clue.id)),
    rules: script.clueDecks,
  };
}

export function advancePhase(script: ScriptPackage, state: GameState): GameState {
  if (state.status === "lobby") {
    return { ...state, status: "playing", eventLog: [...state.eventLog, `游戏开始，进入${script.phases[state.phaseIndex].name}`] };
  }
  if (state.phaseIndex >= script.phases.length - 1) {
    if (!allVotesSubmitted(state)) throw new Error("请等待所有玩家完成最终指认");
    return { ...state, status: "finished" };
  }
  const next = state.phaseIndex + 1;
  return { ...state, status: "playing", phaseIndex: next, eventLog: [...state.eventLog, `进入${script.phases[next].name}`] };
}
