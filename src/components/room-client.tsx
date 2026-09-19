"use client";

import { AlertTriangle, Copy, Fingerprint, Link2, LogOut, Pencil, Radio, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GameRoom } from "./mystery-desk";
import type { RoomAction, RoomSnapshot } from "@/lib/room-store";

type InviteLink = { playerId: string; roleName: string; url: string; canHost: boolean };

export function RoomClient({ code }: { code: string }) {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    const storageKey = `mystery-room-token-${code}`;
    const resolved = fragmentToken || localStorage.getItem(storageKey) || "";
    if (fragmentToken) {
      localStorage.setItem(storageKey, fragmentToken);
      history.replaceState(null, "", window.location.pathname);
    }
    setToken(resolved);
    try {
      setLinks(JSON.parse(localStorage.getItem(`mystery-room-links-${code}`) || "[]") as InviteLink[]);
    } catch {
      setLinks([]);
    }
  }, [code]);

  const loadRoom = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json() as RoomSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error || "同步房间失败");
      setSnapshot(result);
      setConnection("online");
    } catch (error) {
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
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${code}/actions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await response.json() as RoomSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error || "操作失败");
      setSnapshot(result);
      setNotice("");
      setConnection("online");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("邀请链接已复制");
    } catch {
      window.prompt("复制这个邀请链接", url);
    }
  }

  function rename() {
    if (!snapshot) return;
    const current = snapshot.game.players.find((player) => player.id === snapshot.viewer.playerId)?.name || "";
    const name = window.prompt("修改你的玩家昵称", current);
    if (name?.trim()) void action({ type: "rename", name });
  }

  if (!token) {
    return <main className="room-error"><AlertTriangle size={34} /><h1>玩家链接不完整</h1><p>请使用房主发送的完整邀请链接重新进入。</p><a href="/">返回剧本库</a></main>;
  }

  if (!snapshot) {
    return <main className="room-loading"><Fingerprint size={30} /><strong>{connection === "offline" ? "连接中断，正在重试…" : "正在核验玩家席位…"}</strong>{notice ? <span>{notice}</span> : null}</main>;
  }

  const viewer = snapshot.game.players.find((player) => player.id === snapshot.viewer.playerId)!;
  return (
    <div className="app-shell online-room">
      <header className="online-topbar">
        <a className="brand" href="/" aria-label="返回剧本库"><span className="brand-mark"><Fingerprint size={21} /></span><span><strong>谜局</strong><small>ONLINE ROOM</small></span></a>
        <div className="online-room-meta"><span>房间</span><strong>{code}</strong><i className={connection} />{connection === "online" ? "已同步" : "重连中"}</div>
        <div className="viewer-tools">
          <button onClick={rename} title="修改昵称"><Pencil size={16} />{viewer.name}</button>
          {snapshot.viewer.canHost && links.length ? <button className={shareOpen ? "active" : ""} onClick={() => setShareOpen((value) => !value)}><Link2 size={16} />邀请玩家</button> : null}
          <a href="/" title="离开房间"><LogOut size={17} /></a>
        </div>
      </header>

      {notice ? <div className="notice"><AlertTriangle size={16} />{notice}<button onClick={() => setNotice("")}>关闭</button></div> : null}
      {shareOpen ? (
        <section className="invite-drawer">
          <div><UsersRound size={19} /><span><strong>玩家专属链接</strong><small>每个链接只显示对应角色的私密内容</small></span></div>
          <div className="invite-links">{links.map((link, index) => <button key={link.playerId} onClick={() => copyLink(link.url)}><span>{index + 1}</span><strong>{link.roleName}</strong><small>{link.canHost ? "房主席" : "玩家席"}</small><Copy size={15} /></button>)}</div>
        </section>
      ) : null}
      <div className="sync-strip"><Radio size={14} />修订 {snapshot.revision} · {snapshot.onlinePlayerIds.length}/{snapshot.game.players.length} 人在线 · 页面刷新后自动恢复席位</div>
      <GameRoom
        script={snapshot.script}
        game={snapshot.game}
        playerId={snapshot.viewer.playerId}
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
        dmRoom={{ roomCode: code, token }}
        onConclusion={(text) => void action({ type: "conclusion", text })}
        onVote={(roleId) => void action({ type: "vote", roleId })}
        onSetLeader={(roleId) => void action({ type: "setLeader", roleId })}
        onSetActOneAccusation={(roleId) => void action({ type: "setActOneAccusation", roleId })}
      />
    </div>
  );
}
