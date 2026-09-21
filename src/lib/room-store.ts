import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  advancePhase, allVotesSubmitted, availableSpecialTriggers, clueCategory, clueChoiceError, clueTarget, createGame, drawClue, phaseAdvanceError, triggerSpecialClue, visibleContext, visibleRoleForPhase, xiSearchTurn,
  type ClueCategory,
  type GameState, type ScriptPackage, type SearchTurn, type SpecialTrigger,
} from "./domain";

type RoomRecord = {
  code: string;
  revision: number;
  updatedAt: string;
  script: ScriptPackage;
  game: GameState;
  hostPlayerId?: string;
  hostTokenHash?: string;
  inviteTokens?: Record<string, string>;
  tokenHashes: Record<string, string>;
  lastSeen: Record<string, string>;
};

export type RoomViewer = { playerId: string | null; canHost: boolean };
export type RoomSnapshot = {
  revision: number;
  script: ScriptPackage;
  game: GameState;
  viewer: RoomViewer;
  onlinePlayerIds: string[];
  availableDeckIds: string[];
  searchOptions: Array<{ clueId: string; deckId: string; title: string }>;
  specialTriggers: SpecialTrigger[];
  searchTurn?: SearchTurn;
  advanceBlockedReason: string;
  inviteLinks?: Array<{ playerId: string; roleName: string; url: string; canHost: false }>;
};

export type RoomAction =
  | { type: "rename"; name: string }
  | { type: "ready"; ready: boolean }
  | { type: "setLeader"; roleId: string }
  | { type: "setActOneAccusation"; roleId: string }
  | { type: "advance" }
  | { type: "draw"; deckId: string; category?: ClueCategory; targetRoleId?: string; targetClueId?: string }
  | { type: "triggerSpecial"; clueId: string }
  | { type: "conclusion"; text: string }
  | { type: "vote"; roleId: string };

const queues = new Map<string, Promise<unknown>>();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const roomRoot = (override?: string) => override || process.env.ROOM_DATA_DIR || path.join(process.cwd(), "data", "rooms");
const roomPath = (code: string, override?: string) => path.join(roomRoot(override), `${code.toUpperCase()}.json`);
const k2Endings: ScriptPackage["endings"] = [
  { id: "solved", condition: "solved", title: "真相大白", text: "多数票指认真凶。真凶承认罪行并交代过程，维护正义的一方带着罪证离开，所有涉案者将面对法律审判。" },
  { id: "escaped", condition: "escaped", title: "催眠未醒", text: "多数票没有找出真凶。众人继续困在催眠幻境中，在怀疑与罪证的折磨里无法获得解脱。" },
  { id: "framed", condition: "framed", title: "错误指认", text: "多数票指认了调查者。幕后操纵者认定众人无可救药，所有人最终为这次错误指认付出最沉重的代价。" },
];

async function ensureRoot(override?: string) {
  await mkdir(roomRoot(override), { recursive: true });
}

async function readRoom(code: string, override?: string): Promise<RoomRecord> {
  try {
    const room = JSON.parse(await readFile(roomPath(code, override), "utf8")) as RoomRecord;
    const phaseIds = room.script.phases.map((phase) => phase.id).join(",");
    if (phaseIds === "banquet,evidence,final-vote") {
      room.script.phases.splice(2, 0, {
        id: "final-evidence",
        name: "谁是真凶",
        objective: "每人再随机抽取1张尸体线索、1张角色随身物品和2张轮船线索，完成最后调查。",
        hostPrompt: "AI DM开放尸体线索与第二轮搜证；玩家继续通过口述或转述交换信息，不能展示线索卡。",
        allowedActions: ["search", "discuss"],
        durationMinutes: 45,
      });
      if (room.game.phaseIndex >= 2) {
        const hasVotes = room.game.players.some((player) => player.voteRoleId);
        room.game.phaseIndex = hasVotes || room.game.status === "finished" ? 3 : 2;
      }
      if (allVotesSubmitted(room.game)) room.game.status = "finished";
    }
    const evidencePhase = room.script.phases.find((phase) => phase.id === "evidence" && phase.name === "凶案之后");
    if (evidencePhase) {
      evidencePhase.objective = "每人随机抽取1张角色随身物品和3张轮船线索，通过私聊和讨论还原行动线。";
      evidencePhase.hostPrompt = "AI DM宣布进入凶案之后阶段并复述当前阶段规则；线索持有人只能口述或转述，不能展示线索卡。";
    }
    const firstAct = room.script.id === "k2-dark-legend" ? room.script.phases.find((phase) => phase.id === "act-one") : undefined;
    if (firstAct) {
      firstAct.objective = "按五步流程交流、推选 Leader、分组搜查并完成本幕指认。";
      firstAct.hostPrompt = "第一步交流各自经历（15分钟）；第二步投票选出相对最不可疑的一人担任 Leader（10分钟）；第三步除 Leader 外六人自由分成两组三人组，每名组员从另一组一名角色处随机取得1件随身物品（20分钟，Leader不搜查）；第四步先在组内共享搜出的证据，再由 Leader 安排所有人依次发言、询问和反证；第五步若不信任 Leader，可共同要求其公开全部随身物品，否则直接投票指认（15分钟）。完成指认后由房主推进。";
    }
    const secondAct = room.script.id === "k2-dark-legend" ? room.script.phases.find((phase) => phase.id === "act-two") : undefined;
    if (secondAct) {
      secondAct.objective = "重新介绍真实身份，各自选择一个允许搜查且不重复的地点，再集中讨论。";
      secondAct.hostPrompt = "先重新自我介绍并交流（15分钟）。随后每人搜查一处不同地点：指定角色固定搜查案发地点，其余人按各自密档中的限制选择地点；由指定角色统一分发对应线索。回到桌边讨论60分钟，线索只能转述，不可展示。";
    }
    if (room.script.id === "k2-dark-legend") {
      const finalVote = room.script.phases.find((phase) => phase.id === "final-vote");
      if (finalVote) finalVote.hostPrompt = "第二幕讨论结束后，每人独立提交一名指认对象。七名玩家全部提交后，系统按最高票结果公布对应结局；若最高票并列，本轮自动重置并重新投票。";
      room.script.endings = k2Endings;
    }
    return room;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("房间不存在或已失效");
    throw error;
  }
}

async function writeRoom(room: RoomRecord, override?: string) {
  await ensureRoot(override);
  const target = roomPath(room.code, override);
  const temporary = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(room), "utf8");
  await rename(temporary, target);
}

async function locked<T>(code: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(code) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(code, current);
  try {
    return await current;
  } finally {
    if (queues.get(code) === current) queues.delete(code);
  }
}

function authenticate(room: RoomRecord, token: string): RoomViewer {
  const digest = hashToken(token);
  if (room.hostTokenHash === digest) return { playerId: null, canHost: true };
  const playerId = Object.entries(room.tokenHashes).find(([, candidate]) => candidate === digest)?.[0];
  if (!playerId) throw new Error("玩家链接无效");
  if (!room.hostTokenHash && room.game.status === "lobby" && playerId === room.hostPlayerId) {
    const inviteTokens = Object.fromEntries(room.game.players.map((player) => [player.id, randomBytes(24).toString("base64url")]));
    room.hostTokenHash = digest;
    room.inviteTokens = inviteTokens;
    room.tokenHashes = Object.fromEntries(Object.entries(inviteTokens).map(([id, value]) => [id, hashToken(value)]));
    delete room.hostPlayerId;
    return { playerId: null, canHost: true };
  }
  return { playerId, canHost: playerId === room.hostPlayerId };
}

function snapshot(room: RoomRecord, viewer: RoomViewer): RoomSnapshot {
  const viewerPlayer = viewer.playerId ? room.game.players.find((player) => player.id === viewer.playerId) : undefined;
  const visibleClueIds = new Set([...(viewerPlayer?.clueIds ?? []), ...room.game.publicClueIds]);
  const publicRole = room.script.roles.map((role) => role.id === viewerPlayer?.roleId ? visibleRoleForPhase(room.script, room.game, role) : { ...role, privateBrief: "", objectives: [], sourcePages: [] });
  const publicScript: ScriptPackage = {
    ...room.script,
    roles: publicRole,
    clues: room.script.clues.filter((clue) => visibleClueIds.has(clue.id)),
    truth: room.game.status === "finished" ? room.script.truth : { culpritRoleId: "", method: "", motive: "", timeline: [] },
    endings: room.game.status === "finished" ? room.script.endings : [],
  };
  const publicGame: GameState = {
    ...room.game,
    players: room.game.players.map((player) => player.id === viewer.playerId ? player : { ...player, clueIds: [] }),
  };
  const owned = new Set(room.game.players.flatMap((player) => player.clueIds));
  const availableDeckIds = viewerPlayer ? room.script.clueDecks.filter((deck) => room.script.clues.some((clue) =>
    clue.deckId === deck.id &&
    room.script.phases.findIndex((phase) => phase.id === clue.availableFromPhase) <= room.game.phaseIndex &&
    !owned.has(clue.id) &&
    !clueChoiceError(room.script, room.game, viewerPlayer, clue)
  )).map((deck) => deck.id) : [];
  const searchOptions = viewerPlayer ? room.script.clues.filter((clue) =>
    (clue.deckId === "rooms" || (room.script.id === "xi-liangxi-phantom" && clue.deckId === "deep-investigation")) &&
    room.script.phases.findIndex((phase) => phase.id === clue.availableFromPhase) <= room.game.phaseIndex &&
    !owned.has(clue.id) &&
    !clueChoiceError(room.script, room.game, viewerPlayer, clue)
  ).map((clue) => ({ clueId: clue.id, deckId: clue.deckId, title: clue.title })) : [];
  const specialTriggers = viewer.playerId ? availableSpecialTriggers(room.script, room.game, viewer.playerId) : [];
  const searchTurn = xiSearchTurn(room.script, room.game);
  const onlineThreshold = Date.now() - 15_000;
  return {
    revision: room.revision,
    script: publicScript,
    game: publicGame,
    viewer,
    onlinePlayerIds: Object.entries(room.lastSeen).filter(([playerId, timestamp]) => playerId !== "host" && Date.parse(timestamp) >= onlineThreshold).map(([playerId]) => playerId),
    availableDeckIds,
    searchOptions,
    specialTriggers,
    searchTurn,
    advanceBlockedReason: phaseAdvanceError(room.script, room.game),
    inviteLinks: viewer.canHost && room.inviteTokens ? room.game.players.map((player) => ({
      playerId: player.id,
      roleName: room.script.roles.find((role) => role.id === player.roleId)?.name ?? player.name,
      url: `/room/${room.code}#token=${room.inviteTokens![player.id]}`,
      canHost: false as const,
    })) : undefined,
  };
}

export async function createOnlineRoom(script: ScriptPackage, origin: string, override?: string) {
  await ensureRoot(override);
  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    code = randomBytes(3).toString("hex").toUpperCase();
    try { await readFile(roomPath(code, override)); } catch { break; }
  }
  const game = createGame(script, script.roles.map((_, index) => `玩家 ${index + 1}`));
  game.roomCode = code;
  const rawTokens = Object.fromEntries(game.players.map((player) => [player.id, randomBytes(24).toString("base64url")]));
  const hostToken = randomBytes(24).toString("base64url");
  const record: RoomRecord = {
    code,
    revision: 1,
    updatedAt: new Date().toISOString(),
    script,
    game,
    hostTokenHash: hashToken(hostToken),
    inviteTokens: rawTokens,
    tokenHashes: Object.fromEntries(Object.entries(rawTokens).map(([playerId, token]) => [playerId, hashToken(token)])),
    lastSeen: {},
  };
  await writeRoom(record, override);
  const links = game.players.map((player, index) => ({
    playerId: player.id,
    roleName: script.roles[index].name,
    url: `${origin}/room/${code}#token=${rawTokens[player.id]}`,
    canHost: false,
  }));
  return { code, links, hostUrl: `${origin}/room/${code}#token=${hostToken}` };
}

export async function getRoomSnapshot(code: string, token: string, override?: string) {
  return locked(code, async () => {
    const room = await readRoom(code, override);
    const viewer = authenticate(room, token);
    room.lastSeen[viewer.playerId ?? "host"] = new Date().toISOString();
    await writeRoom(room, override);
    return snapshot(room, viewer);
  });
}

export async function applyRoomAction(code: string, token: string, action: RoomAction, override?: string) {
  return locked(code, async () => {
    const room = await readRoom(code, override);
    const viewer = authenticate(room, token);
    const player = viewer.playerId ? room.game.players.find((item) => item.id === viewer.playerId) : undefined;
    const phase = room.script.phases[room.game.phaseIndex];

    if (action.type === "rename") {
      if (!player) throw new Error("房主席不使用玩家昵称");
      const name = action.name.trim().slice(0, 20);
      if (!name) throw new Error("玩家昵称不能为空");
      player.name = name;
    } else if (action.type === "ready") {
      if (!player) throw new Error("房主席没有准备状态");
      player.ready = action.ready;
    } else if (action.type === "setLeader") {
      if (!viewer.canHost) throw new Error("只有房主可以登记 Leader");
      if (room.script.id !== "k2-dark-legend" || phase.id !== "act-one" || room.game.status !== "playing") throw new Error("当前阶段不能登记 Leader");
      const leader = room.game.players.find((item) => item.roleId === action.roleId);
      if (!leader) throw new Error("Leader 对应角色不存在");
      if (leader.clueIds.some((id) => room.script.clues.find((clue) => clue.id === id)?.deckId === "personal-items")) throw new Error("该玩家已经参与搜查，不能再设为 Leader");
      room.game.leaderPlayerId = leader.id;
      room.game.eventLog.push(`本幕 Leader 已确定：${leader.name}`);
    } else if (action.type === "setActOneAccusation") {
      if (!viewer.canHost) throw new Error("只有房主可以登记本幕指认结果");
      if (room.script.id !== "k2-dark-legend" || phase.id !== "act-one" || room.game.status !== "playing") throw new Error("当前阶段不能登记本幕指认结果");
      const target = room.script.roles.find((role) => role.id === action.roleId);
      if (!target) throw new Error("指认对象不存在");
      room.game.actOneAccusationRoleId = target.id;
      room.game.eventLog.push(`第一幕指认结果已登记：${target.name}`);
    } else if (action.type === "advance") {
      if (!viewer.canHost) throw new Error("只有房主可以推进阶段");
      if (room.script.id === "k2-dark-legend" && phase.id === "act-one" && room.game.status === "playing") {
        if (!room.game.leaderPlayerId) throw new Error("请先登记本幕 Leader");
        const unfinished = room.game.players.filter((item) => item.id !== room.game.leaderPlayerId && !item.clueIds.some((id) => room.script.clues.find((clue) => clue.id === id)?.deckId === "personal-items"));
        if (unfinished.length) throw new Error(`还有 ${unfinished.length} 名非 Leader 玩家未完成随身物品搜查`);
        if (!room.game.actOneAccusationRoleId) throw new Error("请先登记第一幕指认结果");
      }
      room.game = advancePhase(room.script, room.game);
    } else if (action.type === "draw") {
      if (!player || !viewer.playerId) throw new Error("房主席不参与搜证");
      if (!phase.allowedActions.includes("search")) throw new Error("当前阶段不能搜证");
      room.game = drawClue(room.script, room.game, viewer.playerId, action.deckId, action.category, action.targetRoleId, action.targetClueId);
    } else if (action.type === "triggerSpecial") {
      if (!player || !viewer.playerId) throw new Error("房主席不参与搜证");
      if (!phase.allowedActions.includes("search")) throw new Error("当前阶段不能触发特殊线索");
      room.game = triggerSpecialClue(room.script, room.game, viewer.playerId, action.clueId);
    } else if (action.type === "conclusion") {
      if (!player) throw new Error("房主席不提交玩家结论");
      const text = action.text.trim().slice(0, 200);
      if (!text) throw new Error("讨论结论不能为空");
      room.game.eventLog.push(`${player.name}：${text}`);
    } else if (action.type === "vote") {
      if (!player) throw new Error("房主席不参与最终指认");
      if (!phase.allowedActions.includes("vote")) throw new Error("当前阶段不能指认");
      if (player.voteRoleId) throw new Error("你已经完成最终指认");
      const target = room.script.roles.find((role) => role.id === action.roleId);
      if (!target) throw new Error("指认对象不存在");
      player.voteRoleId = target.id;
      room.game.eventLog.push(`${player.name} 已完成最终指认`);
      if (allVotesSubmitted(room.game)) {
        const counts = new Map<string, number>();
        for (const voter of room.game.players) counts.set(voter.voteRoleId!, (counts.get(voter.voteRoleId!) ?? 0) + 1);
        const highest = Math.max(...counts.values());
        const leaders = [...counts].filter(([, count]) => count === highest);
        if (leaders.length > 1) {
          for (const voter of room.game.players) delete voter.voteRoleId;
          room.game.eventLog.push("本轮最高票并列，投票已重置，请重新指认");
        } else {
          room.game.status = "finished";
          room.game.eventLog.push("所有玩家已完成最终指认，投票结束");
        }
      }
    }

    room.lastSeen[viewer.playerId ?? "host"] = new Date().toISOString();
    room.revision += 1;
    room.updatedAt = new Date().toISOString();
    await writeRoom(room, override);
    return snapshot(room, viewer);
  });
}

export async function getRoomDmContext(code: string, token: string, override?: string) {
  const room = await readRoom(code, override);
  const viewer = authenticate(room, token);
  if (!viewer.playerId) throw new Error("房主席不使用玩家私密 DM");
  const player = room.game.players.find((item) => item.id === viewer.playerId)!;
  const phase = room.script.phases[room.game.phaseIndex];
  const owned = new Set(room.game.players.flatMap((item) => item.clueIds));
  const categoryNames = { role: "角色随身物品", ship: "轮船线索", body: "尸体线索" } as const;
  const deckStatus = room.script.clueDecks.flatMap((deck) => (["role", "ship", "body"] as const).map((category) => {
    const used = player.clueIds.filter((id) => {
      const clue = room.script.clues.find((item) => item.id === id);
      return clue?.deckId === deck.id && clueCategory(clue) === category;
    }).length;
    const limit = clueTarget(category, room.game.phaseIndex);
    const available = used < limit && room.script.clues.some((clue) => clue.deckId === deck.id && clueCategory(clue) === category && room.script.phases.findIndex((item) => item.id === clue.availableFromPhase) <= room.game.phaseIndex && !owned.has(clue.id));
    return { id: `${deck.id}:${category}`, name: categoryNames[category], used, limit, remaining: Math.max(0, limit - used), available };
  }));
  return {
    playerId: viewer.playerId,
    context: {
      ...visibleContext(room.script, room.game, viewer.playerId),
      allowedActions: phase.allowedActions,
      deckStatus,
    },
  };
}
