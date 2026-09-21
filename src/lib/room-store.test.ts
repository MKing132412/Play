import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyRoomAction, createOnlineRoom, getRoomSnapshot } from "./room-store";
import { sampleScript } from "./sample";

const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;

test("room links restore the assigned player without leaking other private roles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const script = {
      ...sampleScript,
      roles: sampleScript.roles.map((role, index) => ({ ...role, sourcePages: [`/private-role-${index + 1}.webp`] })),
    };
    const created = await createOnlineRoom(script, "http://localhost", root);
    assert.equal(created.links.length, sampleScript.playerCount);
    assert.notEqual(created.hostUrl, created.links[0].url);
    assert.equal(created.links.every((link) => !link.canHost), true);
    const hostSnapshot = await getRoomSnapshot(created.code, tokenOf(created.hostUrl), root);
    assert.equal(hostSnapshot.viewer.playerId, null);
    assert.equal(hostSnapshot.viewer.canHost, true);
    assert.equal(hostSnapshot.script.roles.every((role) => !role.privateBrief && !role.sourcePages?.length), true);
    const snapshot = await getRoomSnapshot(created.code, tokenOf(created.links[1].url), root);
    assert.equal(snapshot.viewer.playerId, "player-2");
    assert.equal(snapshot.viewer.canHost, false);
    assert.equal(snapshot.script.roles[1].privateBrief.length > 0, true);
    assert.deepEqual(snapshot.script.roles[1].sourcePages, ["/private-role-2.webp"]);
    assert.equal(snapshot.script.roles[0].privateBrief, "");
    assert.deepEqual(snapshot.script.roles[0].sourcePages, []);
    assert.equal(snapshot.script.truth.culpritRoleId, "");
    assert.deepEqual(snapshot.script.endings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server room persists phase and private clue across reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const created = await createOnlineRoom(sampleScript, "http://localhost", root);
    const hostToken = tokenOf(created.hostUrl);
    const playerToken = tokenOf(created.links[0].url);
    await applyRoomAction(created.code, hostToken, { type: "advance" }, root);
    await applyRoomAction(created.code, hostToken, { type: "advance" }, root);
    await assert.rejects(applyRoomAction(created.code, hostToken, { type: "draw", deckId: "body" }, root), /房主席不参与搜证/);
    const drawn = await applyRoomAction(created.code, playerToken, { type: "draw", deckId: "body" }, root);
    assert.equal(drawn.game.phaseIndex, 1);
    assert.equal(drawn.game.players[0].clueIds.length, 1);
    const restored = await getRoomSnapshot(created.code, hostToken, root);
    assert.deepEqual(restored.game.players[0].clueIds, []);
    const playerRestored = await getRoomSnapshot(created.code, playerToken, root);
    assert.deepEqual(playerRestored.game.players[0].clueIds, drawn.game.players[0].clueIds);

    const other = await getRoomSnapshot(created.code, tokenOf(created.links[1].url), root);
    assert.deepEqual(other.game.players[0].clueIds, []);
    assert.equal(other.script.clues.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-host player cannot advance the room", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const created = await createOnlineRoom(sampleScript, "http://localhost", root);
    await assert.rejects(
      applyRoomAction(created.code, tokenOf(created.links[2].url), { type: "advance" }, root),
      /只有房主/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only the host can register the K2 Leader", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const script = { ...sampleScript, id: "k2-dark-legend", phases: [{ ...sampleScript.phases[0], id: "act-one" }] };
    const created = await createOnlineRoom(script, "http://localhost", root);
    const hostToken = tokenOf(created.hostUrl);
    await applyRoomAction(created.code, hostToken, { type: "advance" }, root);
    await assert.rejects(
      applyRoomAction(created.code, tokenOf(created.links[1].url), { type: "setLeader", roleId: script.roles[1].id }, root),
      /只有房主/,
    );
    let snapshot = await applyRoomAction(created.code, hostToken, { type: "setLeader", roleId: script.roles[1].id }, root);
    assert.equal(snapshot.game.leaderPlayerId, "player-2");
    snapshot = await applyRoomAction(created.code, hostToken, { type: "setActOneAccusation", roleId: script.roles[2].id }, root);
    assert.equal(snapshot.game.actOneAccusationRoleId, script.roles[2].id);
    await assert.rejects(applyRoomAction(created.code, hostToken, { type: "advance" }, root), /非 Leader 玩家未完成/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the sixth final vote closes the room and reveals truth", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const created = await createOnlineRoom(sampleScript, "http://localhost", root);
    const hostToken = tokenOf(created.hostUrl);
    for (let count = 0; count < sampleScript.phases.length; count += 1) {
      await applyRoomAction(created.code, hostToken, { type: "advance" }, root);
    }
    for (let index = 0; index < created.links.length - 1; index += 1) {
      const snapshot = await applyRoomAction(created.code, tokenOf(created.links[index].url), { type: "vote", roleId: sampleScript.roles[0].id }, root);
      assert.equal(snapshot.game.status, "playing");
    }
    const completed = await applyRoomAction(created.code, tokenOf(created.links.at(-1)!.url), { type: "vote", roleId: sampleScript.roles[0].id }, root);
    assert.equal(completed.game.status, "finished");
    assert.equal(completed.script.truth.culpritRoleId, sampleScript.truth.culpritRoleId);
    assert.match(completed.game.eventLog.at(-1)!, /所有玩家已完成最终指认/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a tied final vote resets instead of choosing an arbitrary ending", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-room-test-"));
  try {
    const created = await createOnlineRoom(sampleScript, "http://localhost", root);
    const hostToken = tokenOf(created.hostUrl);
    for (let count = 0; count < sampleScript.phases.length; count += 1) {
      await applyRoomAction(created.code, hostToken, { type: "advance" }, root);
    }
    for (let index = 0; index < created.links.length; index += 1) {
      const target = index < created.links.length / 2 ? sampleScript.roles[0].id : sampleScript.roles[1].id;
      await applyRoomAction(created.code, tokenOf(created.links[index].url), { type: "vote", roleId: target }, root);
    }
    const snapshot = await getRoomSnapshot(created.code, hostToken, root);
    assert.equal(snapshot.game.status, "playing");
    assert.equal(snapshot.game.players.every((player) => !player.voteRoleId), true);
    assert.match(snapshot.game.eventLog.at(-1)!, /最高票并列/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
