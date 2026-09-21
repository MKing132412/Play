"use client";

import { AlertTriangle, Bot, ChevronRight, Clock3, Copy, Fingerprint, Link2, LogOut, Pencil, Radio, ShieldCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameRoom } from "./mystery-desk";
import type { RoomAction, RoomSnapshot } from "@/lib/room-store";

type InviteLink = { playerId: string; roleName: string; url: string; canHost: boolean };

function HostConsole({ snapshot, busy, onAction }: { snapshot: RoomSnapshot; busy: boolean; onAction: (action: RoomAction) => Promise<void> }) {
  const [leaderRoleId, setLeaderRoleId] = useState("");
  const [accusationRoleId, setAccusationRoleId] = useState("");
  const phase = snapshot.script.phases[snapshot.game.phaseIndex];
  const votesSubmitted = snapshot.game.players.filter((player) => player.voteRoleId).length;
  const voting = phase.allowedActions.includes("vote");
  const advanceDisabled = busy || Boolean(snapshot.advanceBlockedReason) || (voting && votesSubmitted < snapshot.game.players.length);
  const advanceLabel = snapshot.game.status === "lobby"
    ? "开始游戏"
    : snapshot.game.status === "finished"
      ? "游戏已结束"
      : snapshot.advanceBlockedReason
        ? "等待搜证完成"
        : voting
          ? `等待投票 ${votesSubmitted}/${snapshot.game.players.length}`
          : "推进阶段";

  return (
    <main className="host-console">
      <aside className="host-roster">
        <div className="host-seat"><ShieldCheck size={22} /><div><strong>独立房主席</strong><small>不占角色，不参与搜证与投票</small></div></div>
        <h2>玩家席位</h2>
        <div className="host-player-list">{snapshot.game.players.map((player, index) => {
          const role = snapshot.script.roles.find((candidate) => candidate.id === player.roleId);
          const online = snapshot.onlinePlayerIds.includes(player.id);
          return <div key={player.id}><i>{index + 1}</i><span><strong>{player.name}</strong><small>{role?.name}</small></span><b className={online ? "online" : "offline"}>{online ? "在线" : "离线"}</b></div>;
        })}</div>
      </aside>

      <section className="host-stage">
        <div className="phase-header">
          <div className="phase-number">{String(snapshot.game.phaseIndex + 1).padStart(2, "0")}</div>
          <div><p>当前阶段 · {snapshot.game.status === "lobby" ? "等待开始" : snapshot.game.status === "finished" ? "游戏结束" : "进行中"}</p><h1>{phase.name}</h1><span>{phase.objective}</span></div>
          <div className="phase-actions"><button className="secondary-button"><Clock3 size={17} />{phase.durationMinutes}:00</button><button className="primary-button" disabled={advanceDisabled || snapshot.game.status === "finished"} title={snapshot.advanceBlockedReason || undefined} onClick={() => void onAction({ type: "advance" })}>{advanceLabel}<ChevronRight size={17} /></button></div>
        </div>

        <div className="dm-broadcast"><Bot size={24} /><div><strong>DM 主持提示</strong><p>{phase.hostPrompt}</p></div><span>房主可见</span></div>

        {snapshot.script.id === "k2-dark-legend" && phase.id === "act-one" && snapshot.game.status === "playing" ? <section className="leader-panel"><div><small>第一幕职责与指认</small><strong>由房主登记流程结果</strong><span>登记后系统按原规则校验推进条件。</span></div><div className="leader-controls"><div><select aria-label="选择 Leader" value={leaderRoleId} onChange={(event) => setLeaderRoleId(event.target.value)}><option value="">选择 Leader 角色</option>{snapshot.script.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="secondary-button" disabled={!leaderRoleId || busy} onClick={() => void onAction({ type: "setLeader", roleId: leaderRoleId })}>确认 Leader</button></div><div><select aria-label="选择第一幕指认对象" value={accusationRoleId} onChange={(event) => setAccusationRoleId(event.target.value)}><option value="">选择本幕指认对象</option>{snapshot.script.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="secondary-button" disabled={!accusationRoleId || busy} onClick={() => void onAction({ type: "setActOneAccusation", roleId: accusationRoleId })}>登记指认</button></div></div></section> : null}

        <div className="host-status-grid">
          <article><small>玩家在线</small><strong>{snapshot.onlinePlayerIds.length} / {snapshot.game.players.length}</strong></article>
          <article><small>阶段状态</small><strong>{snapshot.advanceBlockedReason || (voting ? `${votesSubmitted} 人已投票` : "可按流程推进")}</strong></article>
          <article><small>当前搜证</small><strong>{snapshot.searchTurn ? `等待 ${snapshot.searchTurn.roleName} · 剩余 ${snapshot.searchTurn.remaining}` : "无固定顺序"}</strong></article>
        </div>

        <section className="host-log"><div><p>PUBLIC LOG</p><h2>公共记录</h2></div><div className="event-log">{snapshot.game.eventLog.toReversed().map((entry, index) => <div key={`${entry}-${index}`}><span>{String(snapshot.game.eventLog.length - index).padStart(2, "0")}</span><p>{entry}</p></div>)}</div></section>
      </section>
    </main>
  );
}

export function RoomClient({ code }: { code: string }) {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [hostToken, setHostToken] = useState("");
  const [playerTokens, setPlayerTokens] = useState<Record<string, string>>({});
  const tokenRef = useRef("");

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    const storageKey = `mystery-room-token-${code}`;
    const hostStorageKey = `mystery-room-host-token-${code}`;
    let savedHostToken = localStorage.getItem(hostStorageKey) || "";
    if (!savedHostToken) {
      try {
        const recentRooms = JSON.parse(localStorage.getItem("mystery-recent-rooms") || "[]") as Array<{ code: string; url: string }>;
        const hostUrl = recentRooms.find((room) => room.code === code)?.url;
        savedHostToken = hostUrl ? new URLSearchParams(new URL(hostUrl).hash.slice(1)).get("token") || "" : "";
        if (savedHostToken) localStorage.setItem(hostStorageKey, savedHostToken);
      } catch {
        savedHostToken = "";
      }
    }
    const resolved = fragmentToken || localStorage.getItem(storageKey) || "";
    if (fragmentToken) {
      localStorage.setItem(storageKey, fragmentToken);
      history.replaceState(null, "", window.location.pathname);
    }
    tokenRef.current = resolved;
    setToken(resolved);
    setHostToken(savedHostToken);
    try {
      setLinks(JSON.parse(localStorage.getItem(`mystery-room-links-${code}`) || "[]") as InviteLink[]);
      setPlayerTokens(JSON.parse(localStorage.getItem(`mystery-room-player-tokens-${code}`) || "{}") as Record<string, string>);
    } catch {
      setLinks([]);
      setPlayerTokens({});
    }
  }, [code]);

  useEffect(() => {
    if (!snapshot?.viewer.canHost || snapshot.viewer.playerId !== null || !token) return;
    localStorage.setItem(`mystery-room-host-token-${code}`, token);
    setHostToken(token);
  }, [code, snapshot?.viewer.canHost, snapshot?.viewer.playerId, token]);

  useEffect(() => {
    const playerId = snapshot?.viewer.playerId;
    if (!playerId || !token) return;
    const next = { ...playerTokens, [playerId]: token };
    localStorage.setItem(`mystery-room-player-tokens-${code}`, JSON.stringify(next));
    setPlayerTokens(next);
    // The current player/token pair only changes when switching seats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, snapshot?.viewer.playerId, token]);

  const loadRoom = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    try {
      const response = await fetch(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${requestToken}` }, cache: "no-store" });
      const result = await response.json() as RoomSnapshot & { error?: string };
      if (tokenRef.current !== requestToken) return;
      if (!response.ok) throw new Error(result.error || "同步房间失败");
      setSnapshot(result);
      setConnection("online");
    } catch (error) {
      if (tokenRef.current !== requestToken) return;
      setConnection("offline");
      setNotice(error instanceof Error ? error.message : "连接已中断，正在重试");
    }
  }, [code, token]);

  useEffect(() => {
    if (!token) return;
    void loadRoom();
    const timer = window.setInterval(() => void loadRoom(), 2_000);
    const onFocus = () => void loadRoom();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [loadRoom, token]);

  async function action(value: RoomAction) {
    if (!token || busy) return;
    const requestToken = token;
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${code}/actions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${requestToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await response.json() as RoomSnapshot & { error?: string };
      if (tokenRef.current !== requestToken) return;
      if (!response.ok) throw new Error(result.error || "操作失败");
      setSnapshot(result);
      setNotice("");
      setConnection("online");
    } catch (error) {
      if (tokenRef.current !== requestToken) return;
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      setNotice("邀请链接已复制");
    } catch {
      window.prompt("复制这个邀请链接", new URL(url, window.location.origin).href);
    }
  }

  function rename() {
    if (!snapshot) return;
    const current = snapshot.game.players.find((player) => player.id === snapshot.viewer.playerId)?.name || "";
    const name = window.prompt("修改你的玩家昵称", current);
    if (name?.trim()) void action({ type: "rename", name });
  }

  function returnToHost() {
    if (!hostToken) return;
    localStorage.setItem(`mystery-room-token-${code}`, hostToken);
    tokenRef.current = hostToken;
    setSnapshot(null);
    setShareOpen(false);
    setToken(hostToken);
  }

  function switchToPlayer(playerId: string) {
    const invite = (snapshot?.inviteLinks?.length ? snapshot.inviteLinks : links).find((link) => link.playerId === playerId);
    const playerToken = playerTokens[playerId] || (invite ? new URLSearchParams(new URL(invite.url, window.location.origin).hash.slice(1)).get("token") || "" : "");
    if (!playerToken) return;
    if (snapshot?.viewer.canHost && snapshot.viewer.playerId === null) {
      localStorage.setItem(`mystery-room-host-token-${code}`, token);
      setHostToken(token);
    }
    localStorage.setItem(`mystery-room-token-${code}`, playerToken);
    tokenRef.current = playerToken;
    setSnapshot(null);
    setShareOpen(false);
    setToken(playerToken);
  }

  if (!token) {
    return <main className="room-error"><AlertTriangle size={34} /><h1>玩家链接不完整</h1><p>请使用房主发送的完整邀请链接重新进入。</p><a href="/">返回剧本库</a></main>;
  }

  if (!snapshot) {
    return <main className="room-loading"><Fingerprint size={30} /><strong>{connection === "offline" ? "连接中断，正在重试…" : "正在核验玩家席位…"}</strong>{notice ? <span>{notice}</span> : null}</main>;
  }

  const viewer = snapshot.viewer.playerId ? snapshot.game.players.find((player) => player.id === snapshot.viewer.playerId) : undefined;
  const inviteLinks = snapshot.inviteLinks?.length ? snapshot.inviteLinks : links;
  const switchablePlayerIds = new Set([...Object.keys(playerTokens), ...inviteLinks.map((link) => link.playerId)]);
  return (
    <div className="app-shell online-room">
      <header className="online-topbar">
        <a className="brand" href="/" aria-label="返回剧本库"><span className="brand-mark"><Fingerprint size={21} /></span><span><strong>谜局</strong><small>ONLINE ROOM</small></span></a>
        <div className="online-room-meta"><span>房间</span><strong>{code}</strong><i className={connection} />{connection === "online" ? "已同步" : "重连中"}</div>
        <div className="viewer-tools">
          {viewer ? <button onClick={rename} title="修改昵称"><Pencil size={16} />{viewer.name}</button> : <button disabled title="独立房主席"><ShieldCheck size={16} />房主 / DM</button>}
          {viewer && hostToken && hostToken !== token ? <button className="return-host-button" onClick={returnToHost} title="返回独立房主席"><ShieldCheck size={16} />返回房主</button> : null}
          {!viewer && switchablePlayerIds.size ? <select aria-label="切换玩家视角" value="" onChange={(event) => switchToPlayer(event.target.value)}><option value="">切换玩家视角</option>{snapshot.game.players.filter((player) => switchablePlayerIds.has(player.id)).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select> : null}
          {snapshot.viewer.canHost && inviteLinks.length ? <button className={shareOpen ? "active" : ""} onClick={() => setShareOpen((value) => !value)}><Link2 size={16} />邀请玩家</button> : null}
          <a href="/" title="离开房间"><LogOut size={17} /></a>
        </div>
      </header>

      {notice ? <div className="notice"><AlertTriangle size={16} />{notice}<button onClick={() => setNotice("")}>关闭</button></div> : null}
      {shareOpen ? (
        <section className="invite-drawer">
          <div><UsersRound size={19} /><span><strong>玩家专属链接</strong><small>每个链接只显示对应角色的私密内容</small></span></div>
          <div className="invite-links">{inviteLinks.map((link, index) => <button key={link.playerId} onClick={() => copyLink(link.url)}><span>{index + 1}</span><strong>{link.roleName}</strong><small>玩家席</small><Copy size={15} /></button>)}</div>
        </section>
      ) : null}
      <div className="sync-strip"><Radio size={14} />修订 {snapshot.revision} · {snapshot.onlinePlayerIds.length}/{snapshot.game.players.length} 人在线 · 页面刷新后自动恢复席位</div>
      {!viewer ? <HostConsole snapshot={snapshot} busy={busy} onAction={action} /> : <GameRoom
        script={snapshot.script}
        game={snapshot.game}
        playerId={viewer.id}
        onPlayerChange={() => undefined}
        onGameChange={() => undefined}
        onDraw={(deckId, category, targetRoleId, targetClueId) => void action({ type: "draw", deckId, category, targetRoleId, targetClueId })}
        onTriggerSpecial={(clueId) => void action({ type: "triggerSpecial", clueId })}
        onAdvance={() => void action({ type: "advance" })}
        onNotice={setNotice}
        canHost={snapshot.viewer.canHost}
        canSwitchPlayers={false}
        onlinePlayerIds={snapshot.onlinePlayerIds}
        availableDeckIds={snapshot.availableDeckIds}
        searchOptions={snapshot.searchOptions}
        specialTriggers={snapshot.specialTriggers}
        searchTurn={snapshot.searchTurn}
        advanceBlockedReason={snapshot.advanceBlockedReason}
        dmRoom={{ roomCode: code, token }}
        onConclusion={(text) => void action({ type: "conclusion", text })}
        onVote={(roleId) => void action({ type: "vote", roleId })}
        onSetLeader={(roleId) => void action({ type: "setLeader", roleId })}
        onSetActOneAccusation={(roleId) => void action({ type: "setActOneAccusation", roleId })}
      />}
    </div>
  );
}
