"use client";

import {
  AlertTriangle, Archive, ArrowRight, Bot, Check, ChevronRight, CircleHelp,
  Clock3, Eye, FileSearch, FileUp, Fingerprint, FolderUp, Gavel, KeyRound, LockKeyhole,
  Map, MessageSquareText, Play, Plus, Search, ShieldCheck, Sparkles, Trash2, UsersRound, Vote, X,
} from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  advancePhase, availableSpecialTriggers, createGame, drawClue, triggerSpecialClue, validateScript, visibleContext,
  allVotesSubmitted, clueCategory, clueQuota, clueTarget, type ClueCategory, type GameState, type ScriptPackage,
} from "@/lib/domain";
import { sampleScript } from "@/lib/sample";
import { buildImportManifest, importPath, maxImportBytes, nestedImportRoots, selectImportFiles, type ImportManifest } from "@/lib/import-files";
import type { ScriptSummary, StoredScript } from "@/lib/script-store";

type View = "library" | "review" | "rooms" | "game";
type ImportResult = { script?: ScriptPackage; mode?: "demo" | "ai"; manifest?: ImportManifest; library?: ScriptSummary; reused?: boolean; error?: string };
type ImportEvent = ImportResult & { type?: "progress" | "result" | "error"; message?: string };
const storageKey = "mystery-dm-state-v1";

function uploadImport(form: FormData, onUpload: (percent: number) => void, onEvent: (event: ImportEvent) => void) {
  return new Promise<ImportResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let offset = 0;
    let buffer = "";
    let result: ImportResult = {};
    let streamedError = "";

    const consumeEvents = (final = false) => {
      buffer += request.responseText.slice(offset);
      offset = request.responseText.length;
      const lines = buffer.split("\n");
      buffer = final ? "" : lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as ImportEvent;
        onEvent(event);
        if (event.type === "error") streamedError = event.error || "导入失败";
        if (event.type === "result") result = event;
      }
    };

    request.open("POST", "/api/import");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onUpload(Math.round((event.loaded / event.total) * 100));
    };
    request.upload.onload = () => onUpload(100);
    request.onprogress = () => {
      if (request.getResponseHeader("content-type")?.includes("application/x-ndjson")) consumeEvents();
    };
    request.onload = () => {
      try {
        if (!request.getResponseHeader("content-type")?.includes("application/x-ndjson")) {
          result = JSON.parse(request.responseText) as ImportResult;
        } else {
          consumeEvents(true);
        }
        if (streamedError) throw new Error(streamedError);
        if (request.status < 200 || request.status >= 300) throw new Error(result.error || "导入失败");
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(new Error("上传中断，请检查本地服务是否仍在运行"));
    request.send(form);
  });
}

export function MysteryDesk() {
  const [view, setView] = useState<View>("library");
  const [script, setScript] = useState<ScriptPackage>(sampleScript);
  const [game, setGame] = useState<GameState | null>(null);
  const [activePlayerId, setActivePlayerId] = useState("player-1");
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [importStatus, setImportStatus] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [importMode, setImportMode] = useState<"demo" | "ai">("demo");
  const [manifest, setManifest] = useState<ImportManifest | null>(null);
  const [libraryItems, setLibraryItems] = useState<ScriptSummary[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState("");
  const [scriptDirty, setScriptDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const saveRevision = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { script: ScriptPackage; game: GameState | null; importMode?: "demo" | "ai"; manifest?: ImportManifest | null; activeLibraryId?: string };
      setScript(parsed.script);
      setGame(parsed.game);
      setImportMode(parsed.importMode ?? "demo");
      setManifest(parsed.manifest ?? null);
      setActiveLibraryId(parsed.activeLibraryId ?? "");
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ script, game, importMode, manifest, activeLibraryId }));
  }, [script, game, importMode, manifest, activeLibraryId]);

  useEffect(() => {
    fetch("/api/scripts", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { scripts?: ScriptSummary[]; error?: string };
        if (!response.ok) throw new Error(result.error || "读取剧本库失败");
        let items = result.scripts ?? [];
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const legacy = JSON.parse(saved) as { script?: ScriptPackage; importMode?: "demo" | "ai"; manifest?: ImportManifest | null; activeLibraryId?: string };
          if (legacy.importMode === "ai" && legacy.script && legacy.manifest && !legacy.activeLibraryId) {
            const migrationResponse = await fetch("/api/scripts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ script: legacy.script, manifest: legacy.manifest, sourceName: legacy.script.title }),
            });
            const migration = await migrationResponse.json() as { summary?: ScriptSummary; error?: string };
            if (!migrationResponse.ok || !migration.summary) throw new Error(migration.error || "迁移已有剧本失败");
            items = [migration.summary, ...items.filter((item) => item.id !== migration.summary!.id)];
            setActiveLibraryId(migration.summary.id);
          }
        }
        setLibraryItems(items);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "读取剧本库失败"));
  }, []);

  useEffect(() => {
    if (!scriptDirty || !activeLibraryId || importMode !== "ai") return;
    const libraryId = activeLibraryId;
    const revision = ++saveRevision.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/scripts/${libraryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script }),
        });
        const result = await response.json() as { summary?: ScriptSummary; error?: string };
        if (!response.ok || !result.summary) throw new Error(result.error || "保存剧本失败");
        setLibraryItems((items) => items.map((item) => item.id === libraryId ? result.summary! : item).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        if (saveRevision.current === revision) setScriptDirty(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "保存剧本失败");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeLibraryId, importMode, script, scriptDirty]);

  const issues = useMemo(() => validateScript(script), [script]);
  const activePlayer = game?.players.find((player) => player.id === activePlayerId) ?? game?.players[0];

  async function importFiles(input: FileList | null) {
    if (!input?.length) return;
    const inputFiles = Array.from(input);
    const packageRoots = nestedImportRoots(inputFiles);
    if (packageRoots.length > 1) {
      setNotice(`检测到 ${packageRoots.length} 个剧本目录（${packageRoots.join("、")}），请进入其中一个剧本文件夹后再选择`);
      return;
    }
    const files = selectImportFiles(inputFiles);
    if (!files.length) {
      setNotice("文件夹内没有可解析的 PDF、图片、TXT 或 JSON 文件");
      return;
    }
    const nextManifest = buildImportManifest(files);
    const totalBytes = nextManifest.totalBytes;
    if (totalBytes > maxImportBytes) {
      setNotice(`有效文件共 ${(totalBytes / 1024 / 1024).toFixed(1)}MB，单次最多 160MB`);
      return;
    }
    setImporting(true);
    setImportCount(files.length);
    setImportProgress(1);
    setImportStatus("正在准备上传…");
    setNotice("");
    const form = new FormData();
    files.forEach((file) => {
      form.append("files", file, file.name);
      form.append("paths", importPath(file));
    });
    try {
      const result = await uploadImport(form, (percent) => {
        setImportProgress(Math.max(2, Math.round(percent * 0.35)));
        setImportStatus(percent < 100 ? `正在上传文件… ${percent}%` : "上传完成，等待开始解析…");
      }, (event) => {
        if (event.type !== "progress" || !event.message) return;
        setImportStatus(event.message);
        const completed = event.message.match(/已完成\s+(\d+)\/(\d+)/);
        if (completed) {
          setImportProgress(35 + Math.round((Number(completed[1]) / Number(completed[2])) * 55));
        } else if (event.message.includes("正在汇总")) {
          setImportProgress(94);
        } else {
          setImportProgress((current) => Math.max(current, 38));
        }
      });
      if (!result.script) throw new Error(result.error || "导入未返回剧本数据");
      setImportProgress(100);
      setImportStatus("导入完成，正在打开审核台…");
      setScript(result.script);
      setImportMode(result.mode ?? "demo");
      setManifest(result.manifest ?? nextManifest);
      setActiveLibraryId(result.library?.id ?? "");
      setScriptDirty(false);
      if (result.library) {
        setLibraryItems((items) => [result.library!, ...items.filter((item) => item.id !== result.library!.id)]);
      }
      setGame(null);
      setView("review");
      if (result.reused) setNotice("检测到完全相同的文件，已直接打开剧本库中的已有解析结果");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
      setImportCount(0);
      setImportStatus("");
      setImportProgress(0);
    }
  }

  async function openLibraryScript(id: string) {
    try {
      const response = await fetch(`/api/scripts/${id}`, { cache: "no-store" });
      const result = await response.json() as { record?: StoredScript; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || "读取剧本失败");
      setScript(result.record.script);
      setManifest(result.record.manifest);
      setImportMode("ai");
      setActiveLibraryId(result.record.id);
      setScriptDirty(false);
      setGame(null);
      setView("review");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取剧本失败");
    }
  }

  async function deleteLibraryScript(id: string) {
    const item = libraryItems.find((candidate) => candidate.id === id);
    if (!item || !window.confirm(`确定从剧本库删除“${item.title}”v${item.version}？已创建的房间不会受影响。`)) return;
    try {
      const response = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || "删除剧本失败");
      }
      setLibraryItems((items) => items.filter((candidate) => candidate.id !== id));
      if (activeLibraryId === id) {
        setScript(sampleScript);
        setManifest(null);
        setImportMode("demo");
        setActiveLibraryId("");
        setGame(null);
      }
      setNotice("剧本已从库中删除，既有游戏房间仍可继续使用");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除剧本失败");
    }
  }

  async function beginGame() {
    if (importMode !== "ai") {
      setNotice("当前是内置演示数据，请先完整导入剧本文件夹再创建房间");
      return;
    }
    if (issues.some((issue) => issue.level === "error")) return;
    try {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script, origin: window.location.origin }) });
      const result = await response.json() as { code?: string; hostUrl?: string; links?: unknown[]; error?: string };
      if (!response.ok || !result.code || !result.hostUrl) throw new Error(result.error || "创建房间失败");
      localStorage.setItem(`mystery-room-links-${result.code}`, JSON.stringify(result.links ?? []));
      const recentRooms = JSON.parse(localStorage.getItem("mystery-recent-rooms") || "[]") as Array<{ code: string; title: string; url: string; seenAt: string }>;
      const nextRecentRooms = [{ code: result.code, title: script.title, url: result.hostUrl, seenAt: new Date().toISOString() }, ...recentRooms.filter((item) => item.code !== result.code)].slice(0, 12);
      localStorage.setItem("mystery-recent-rooms", JSON.stringify(nextRecentRooms));
      window.location.assign(result.hostUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建房间失败");
    }
  }

  function mutate(action: () => GameState) {
    try {
      const next = action();
      startTransition(() => setGame(next));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="app-shell">
      <Header view={view} setView={setView} hasGame={Boolean(game)} />
      {notice ? <div className="notice"><AlertTriangle size={16} />{notice}<button onClick={() => setNotice("")}>关闭</button></div> : null}
      {view === "library" ? <Library demoScript={sampleScript} scripts={libraryItems} activeId={activeLibraryId} importing={importing} importCount={importCount} importStatus={importStatus} importProgress={importProgress} onImport={importFiles} onOpen={openLibraryScript} onDelete={deleteLibraryScript} onOpenDemo={() => { setScript(sampleScript); setImportMode("demo"); setManifest(null); setActiveLibraryId(""); setView("review"); }} /> : null}
      {view === "review" ? <Review script={script} issues={issues} mode={importMode} manifest={manifest} onScriptChange={(next) => { setScript(next); setGame(null); setScriptDirty(true); }} onBegin={beginGame} /> : null}
      {view === "rooms" ? <RoomHub script={script} onLibrary={() => setView("library")} /> : null}
      {view === "game" && game && activePlayer ? (
        <GameRoom
          script={script}
          game={game}
          playerId={activePlayer.id}
          onPlayerChange={setActivePlayerId}
          onGameChange={setGame}
          onDraw={(deckId, category, targetRoleId, targetClueId) => mutate(() => drawClue(script, game, activePlayer.id, deckId, category, targetRoleId, targetClueId))}
          onTriggerSpecial={(clueId) => mutate(() => triggerSpecialClue(script, game, activePlayer.id, clueId))}
          onAdvance={() => mutate(() => advancePhase(script, game))}
          onNotice={setNotice}
        />
      ) : null}
    </div>
  );
}

function Header({ view, setView, hasGame }: { view: View; setView: (view: View) => void; hasGame: boolean }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => setView("library")} aria-label="返回剧本库">
        <span className="brand-mark"><Fingerprint size={21} /></span>
        <span><strong>谜局</strong><small>AI MYSTERY DESK</small></span>
      </button>
      <nav aria-label="主要导航">
        <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}><Archive size={16} />剧本库</button>
        <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}><FileSearch size={16} />导入审核</button>
        <button className={view === "rooms" ? "active" : ""} onClick={() => setView("rooms")}><UsersRound size={16} />房间</button>
        <button disabled={!hasGame} className={view === "game" ? "active" : ""} onClick={() => setView("game")}><Gavel size={16} />主持台</button>
      </nav>
      <div className="system-state"><span />本地原型</div>
    </header>
  );
}

function RoomHub({ script, onLibrary }: { script: ScriptPackage; onLibrary: () => void }) {
  const [invite, setInvite] = useState("");
  const [notice, setNotice] = useState("");
  const [recentRooms, setRecentRooms] = useState<Array<{ code: string; title: string; url: string; seenAt: string }>>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("mystery-recent-rooms") || "[]") as Array<{ code: string; title: string; url: string; seenAt: string }>;
      const remembered = Object.keys(localStorage)
        .filter((key) => key.startsWith("mystery-room-token-"))
        .map((key) => {
          const code = key.replace("mystery-room-token-", "").toUpperCase();
          const token = localStorage.getItem(key);
          return token ? { code, title: `房间 ${code}`, url: `${window.location.origin}/room/${code}#token=${token}`, seenAt: new Date().toISOString() } : null;
        })
        .filter((item): item is { code: string; title: string; url: string; seenAt: string } => Boolean(item));
      const merged = [...stored, ...remembered].filter((item, index, items) => items.findIndex((candidate) => candidate.code === item.code) === index).slice(0, 12);
      setRecentRooms(merged);
    } catch {
      setRecentRooms([]);
    }
  }, []);

  function openInvite(value: string) {
    try {
      const url = new URL(value.trim(), window.location.origin);
      if (!/^\/room\/[A-Za-z0-9_-]+$/.test(url.pathname) || !url.hash.includes("token=")) throw new Error("请输入带玩家令牌的完整邀请链接");
      window.location.assign(url.toString());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "邀请链接格式不正确");
    }
  }

  return (
    <main className="room-hub">
      <section className="room-hub-heading">
        <div><p className="kicker">ONLINE ROOMS</p><h1>房间</h1><p>进入朋友发来的专属链接，或查看这台设备记住的房间。</p></div>
        <button className="secondary-button" onClick={onLibrary}><Archive size={16} />回到剧本库</button>
      </section>
      <section className="room-hub-grid">
        <article className="room-entry-panel">
          <div className="section-title compact"><div><p>JOIN ROOM</p><h2>进入已有房间</h2></div><UsersRound size={19} /></div>
          <p className="room-hub-copy">粘贴房主发送的完整邀请链接，每位玩家使用自己的角色链接进入。</p>
          <div className="room-join-form"><input value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="https://你的域名/room/ABC123#token=…" aria-label="房间邀请链接" onKeyDown={(event) => { if (event.key === "Enter") openInvite(invite); }} /><button className="primary-button" onClick={() => openInvite(invite)} disabled={!invite.trim()}><ArrowRight size={16} />进入房间</button></div>
          {notice ? <p className="room-hub-notice">{notice}</p> : null}
        </article>
        <article className="room-entry-panel">
          <div className="section-title compact"><div><p>CREATE ROOM</p><h2>创建新房间</h2></div><Play size={19} /></div>
          <p className="room-hub-copy">当前选中的剧本：<strong>{script.title}</strong></p>
          <button className="primary-button" onClick={onLibrary}><Archive size={16} />前往审核并创建</button>
        </article>
      </section>
      <section className="room-history">
        <div className="section-title compact"><div><p>RECENT</p><h2>最近房间</h2></div><span className="badge">{recentRooms.length} 个</span></div>
        {recentRooms.length ? <div className="room-history-list">{recentRooms.map((room) => <button key={room.code} onClick={() => openInvite(room.url)}><span><UsersRound size={16} /><strong>{room.title}</strong><small>{room.code}</small></span><ArrowRight size={17} /></button>)}</div> : <div className="room-history-empty"><UsersRound size={24} /><span>这台设备还没有记住的房间</span></div>}
      </section>
    </main>
  );
}

function Library({ demoScript, scripts, activeId, importing, importCount, importStatus, importProgress, onImport, onOpen, onDelete, onOpenDemo }: { demoScript: ScriptPackage; scripts: ScriptSummary[]; activeId: string; importing: boolean; importCount: number; importStatus: string; importProgress: number; onImport: (files: FileList | null) => void; onOpen: (id: string) => void; onDelete: (id: string) => void; onOpenDemo: () => void }) {
  return (
    <main className="library-layout">
      <section className="library-heading">
        <div>
          <p className="kicker">案件档案库</p>
          <h1>今晚，谁来主持？</h1>
          <p>导入扫描剧本，核对关键规则，然后把主持工作交给系统与 AI DM。</p>
        </div>
        <div className="import-actions">
          <label className={`primary-button ${importing ? "disabled" : ""}`}>
            <FolderUp size={18} />{importing ? `正在解析 ${importCount} 个文件…` : "导入整个文件夹"}
            <input ref={(node) => node?.setAttribute("webkitdirectory", "")} type="file" multiple disabled={importing} onChange={(event) => onImport(event.target.files)} />
          </label>
          <label className={`secondary-button file-button ${importing ? "disabled" : ""}`}>
            <FileUp size={17} />选择部分文件
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.txt,.json" multiple disabled={importing} onChange={(event) => onImport(event.target.files)} />
          </label>
        </div>
        {importing ? (
          <div className="import-progress" role="status" aria-live="polite">
            <div className="import-progress-header"><strong>正在导入 {importCount} 个有效文件</strong><span>{importProgress}%</span></div>
            <progress max="100" value={importProgress} aria-label={`导入进度 ${importProgress}%`} />
            <small>{importStatus}</small>
          </div>
        ) : null}
      </section>

      <section className="case-list" aria-label="剧本库">
        {scripts.map((item, itemIndex) => (
          <article className={`case-row ${item.id === activeId ? "active" : ""}`} key={item.id}>
            <div className="case-art" aria-hidden="true"><span>CASE · V{item.version}</span><strong>{String(itemIndex + 1).padStart(2, "0")}</strong><div className="route-line" /></div>
            <div className="case-main">
              <div className="case-status"><span>服务端已保存</span><span>{item.playerCount} 人</span><span>约 {item.estimatedMinutes} 分钟</span><span>{item.clueCount} 条线索</span></div>
              <h2>{item.title}</h2>
              <p>{item.synopsis}</p>
              <div className="role-strip">{item.roleNames.map((name, index) => <span key={`${name}-${index}`}><i>{String(index + 1).padStart(2, "0")}</i>{name}</span>)}</div>
            </div>
            <div className="case-actions">
              <button className="case-open" onClick={() => onOpen(item.id)}><span>打开审核台</span><ArrowRight size={21} /></button>
              <button className="case-delete" onClick={() => onDelete(item.id)} aria-label={`删除 ${item.title}`} title="删除此版本"><Trash2 size={17} /></button>
            </div>
          </article>
        ))}
        {!scripts.length ? (
          <article className="case-row demo-case">
            <div className="case-art" aria-hidden="true"><span>DEMO</span><strong>00</strong><div className="route-line" /></div>
            <div className="case-main">
              <div className="case-status"><span>内置演示 · 非导入结果</span><span>{demoScript.playerCount} 人</span><span>约 {demoScript.estimatedMinutes} 分钟</span></div>
              <h2>{demoScript.title}</h2><p>{demoScript.synopsis}</p>
              <div className="role-strip">{demoScript.roles.map((role, index) => <span key={role.id}><i>{String(index + 1).padStart(2, "0")}</i>{role.name}</span>)}</div>
            </div>
            <button className="case-open" onClick={onOpenDemo}><span>查看演示</span><ArrowRight size={21} /></button>
          </article>
        ) : null}
      </section>

      <section className="workflow-band">
        <div><FolderUp size={20} /><strong>导入</strong><span>PDF / JPG / PNG</span></div><ChevronRight />
        <div><Sparkles size={20} /><strong>解析</strong><span>角色、阶段、线索</span></div><ChevronRight />
        <div><ShieldCheck size={20} /><strong>复核</strong><span>关键字段人工确认</span></div><ChevronRight />
        <div><Play size={20} /><strong>开局</strong><span>按剧本动态建房</span></div>
      </section>
    </main>
  );
}

function Review({ script, issues, mode, manifest, onScriptChange, onBegin }: { script: ScriptPackage; issues: ReturnType<typeof validateScript>; mode: "demo" | "ai"; manifest: ImportManifest | null; onScriptChange: (script: ScriptPackage) => void; onBegin: () => void }) {
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(script.review.filter((item) => item.confidence === "high").map((item) => item.path)));
  const confidenceCount = (value: string) => script.review.filter((item) => item.confidence === value).length;
  const incompleteRoles = script.roles.filter((role) => role.privateBrief.trim().length < 120);
  const blocked = issues.some((issue) => issue.level === "error") || incompleteRoles.length > 0;
  const pendingCritical = script.review.some((item) => item.confidence === "low" && !confirmed.has(item.path));
  const toggleConfirmed = (path: string) => setConfirmed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const updateClue = (index: number, patch: Partial<ScriptPackage["clues"][number]>) => onScriptChange({
    ...script,
    clues: script.clues.map((clue, clueIndex) => clueIndex === index ? { ...clue, ...patch } : clue),
  });
  const updateRole = (index: number, patch: Partial<ScriptPackage["roles"][number]>) => onScriptChange({
    ...script,
    roles: script.roles.map((role, roleIndex) => roleIndex === index ? { ...role, ...patch } : role),
  });
  const addClue = () => {
    const sequence = script.clues.length + 1;
    onScriptChange({
      ...script,
      clues: [...script.clues, {
        id: `clue-${Date.now()}`,
        title: `待补线索 ${sequence}`,
        content: "请根据扫描图补录线索内容",
        deckId: script.clueDecks[0]?.id ?? "unassigned",
        availableFromPhase: script.phases[0]?.id ?? "unassigned",
        visibility: "private",
        sourceRef: "待填写来源扫描图",
      }],
    });
  };
  const removeClue = (index: number) => onScriptChange({ ...script, clues: script.clues.filter((_, clueIndex) => clueIndex !== index) });
  return (
    <main className="review-layout">
      <aside className="review-summary">
        <div className="seal"><ShieldCheck size={28} /><span>解析报告</span></div>
        <h1>{script.title}</h1>
        <p>{script.synopsis}</p>
        <dl>
          <div><dt>玩家</dt><dd>{script.playerCount} 人</dd></div>
          <div><dt>角色</dt><dd>{script.roles.length} 份</dd></div>
          <div><dt>阶段</dt><dd>{script.phases.length} 个</dd></div>
          <div><dt>线索</dt><dd>{script.clues.length} 条</dd></div>
        </dl>
        <div className="confidence-meter">
          <span style={{ flex: confidenceCount("high") || 1 }} className="high" />
          <span style={{ flex: confidenceCount("medium") || 0.2 }} className="medium" />
          <span style={{ flex: confidenceCount("low") || 0.2 }} className="low" />
        </div>
        <small>{mode === "ai" ? "AI 文件解析结果" : "内置演示数据，不是文件解析结果"} · 内容可在右侧直接修改</small>
        <button className="primary-button full" onClick={onBegin} disabled={mode !== "ai" || blocked || pendingCritical}><Play size={18} />{mode !== "ai" ? "先导入真实剧本" : incompleteRoles.length ? "先补全角色密档" : pendingCritical ? "先确认低置信度字段" : "通过审核并创建房间"}</button>
      </aside>

      <section className="review-workspace">
        <div className="section-title"><div><p>STRUCTURE CHECK</p><h2>结构与一致性</h2></div><span className={blocked ? "badge danger" : "badge ok"}>{blocked ? "存在阻塞项" : "结构通过"}</span></div>
        <div className="check-grid">
          {issues.length === 0 ? <CheckItem title="结构校验通过" detail="角色、阶段和线索引用均有效" tone="ok" /> : issues.map((issue) => <CheckItem key={issue.message} title={issue.level === "error" ? "阻塞问题" : "需要注意"} detail={issue.message} tone={issue.level} />)}
          <CheckItem title={`${script.roles.length} 份角色本`} detail="数量与玩家人数一致" tone="ok" />
          <CheckItem title={`${script.clueDecks.length} 类线索牌组`} detail="所有线索均绑定阶段与牌组" tone="ok" />
          <CheckItem title={incompleteRoles.length ? `${incompleteRoles.length} 份角色密档过短` : "角色密档内容完整"} detail={incompleteRoles.length ? `需补全：${incompleteRoles.map((role) => role.name).join("、")}` : "每份私人经历均达到可读长度"} tone={incompleteRoles.length ? "error" : "ok"} />
          {manifest ? <CheckItem title={`${manifest.clueScanPaths.length} 张线索卡扫描图`} detail={manifest.missingClueScanNumbers.length ? `文件编号缺少 ${manifest.missingClueScanNumbers.map((value) => String(value).padStart(3, "0")).join("、")}` : "扫描图文件编号连续"} tone={manifest.missingClueScanNumbers.length ? "warning" : "ok"} /> : null}
        </div>

        <div className="section-title compact"><div><p>EDIT SCRIPT</p><h2>基础信息校对</h2></div><span className="badge ok">修改自动保存到剧本库</span></div>
        <div className="script-fields">
          <label><span>剧本名称</span><input value={script.title} onChange={(event) => onScriptChange({ ...script, title: event.target.value })} /></label>
          <label><span>玩家人数</span><input type="number" min="1" value={script.playerCount} onChange={(event) => onScriptChange({ ...script, playerCount: Number(event.target.value) })} /></label>
          <label><span>预计分钟</span><input type="number" min="10" value={script.estimatedMinutes} onChange={(event) => onScriptChange({ ...script, estimatedMinutes: Number(event.target.value) })} /></label>
          <label className="wide"><span>案件简介</span><textarea value={script.synopsis} onChange={(event) => onScriptChange({ ...script, synopsis: event.target.value })} /></label>
        </div>

        <div className="section-title compact"><div><p>ROLE AUDIT</p><h2>角色密档校对 · {script.roles.length} 份</h2></div></div>
        <p className="audit-help">玩家开局后看到的内容以此处为准。私人经历应包含完整时间线、人物关系、秘密与行动依据。</p>
        <div className="role-audit-list">
          {script.roles.map((role, index) => (
            <article key={role.id}>
              <div className="role-audit-head"><strong>{String(index + 1).padStart(2, "0")}</strong><input aria-label={`角色 ${index + 1} 姓名`} value={role.name} onChange={(event) => updateRole(index, { name: event.target.value })} /></div>
              <label><span>公开身份</span><textarea value={role.publicBio} onChange={(event) => updateRole(index, { publicBio: event.target.value })} /></label>
              <label><span>私人经历与完整时间线</span><textarea className="role-brief-input" value={role.privateBrief} onChange={(event) => updateRole(index, { privateBrief: event.target.value })} /></label>
              <label><span>个人任务（每行一项）</span><textarea value={role.objectives.join("\n")} onChange={(event) => updateRole(index, { objectives: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></label>
            </article>
          ))}
        </div>

        <div className="section-title compact"><div><p>REVIEW QUEUE</p><h2>字段复核队列</h2></div></div>
        <div className="review-table">
          <div className="table-head"><span>字段</span><span>置信度</span><span>识别依据 / 待办</span><span>状态</span></div>
          {script.review.map((item) => (
            <div className="table-row" key={item.path}>
              <code>{item.path}</code>
              <span className={`confidence ${item.confidence}`}>{item.confidence === "high" ? "高" : item.confidence === "medium" ? "中" : "低"}</span>
              <span>{item.note}</span>
              <button className={`icon-button ${confirmed.has(item.path) ? "confirmed" : ""}`} title={confirmed.has(item.path) ? "取消确认" : "标记为已确认"} onClick={() => toggleConfirmed(item.path)}>{confirmed.has(item.path) ? <Check size={16} /> : <AlertTriangle size={16} />}</button>
            </div>
          ))}
        </div>

        <div className="section-title compact"><div><p>CLUE AUDIT</p><h2>逐卡核对 · {script.clues.length} 条</h2></div><button className="secondary-button" onClick={addClue}><Plus size={16} />补录线索</button></div>
        <p className="audit-help">扫描图可能排版多张实体卡。请按来源逐卡核对，缺失时补录，误识别时删除。</p>
        <div className="clue-audit-list">
          {script.clues.map((clue, index) => (
            <article key={clue.id}>
              <div className="clue-audit-head"><strong>{String(index + 1).padStart(2, "0")}</strong><input aria-label={`线索 ${index + 1} 标题`} value={clue.title} onChange={(event) => updateClue(index, { title: event.target.value })} /><button className="icon-button" title="删除线索" onClick={() => removeClue(index)}><Trash2 size={15} /></button></div>
              <textarea aria-label={`线索 ${index + 1} 内容`} value={clue.content} onChange={(event) => updateClue(index, { content: event.target.value })} />
              <div className="clue-audit-meta">
                <label><span>牌组</span><select value={clue.deckId} onChange={(event) => updateClue(index, { deckId: event.target.value })}>{script.clueDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
                <label><span>开放阶段</span><select value={clue.availableFromPhase} onChange={(event) => updateClue(index, { availableFromPhase: event.target.value })}>{script.phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label>
                <label><span>可见性</span><select value={clue.visibility} onChange={(event) => updateClue(index, { visibility: event.target.value as "private" | "public" })}><option value="private">抽取后私密</option><option value="public">公开</option></select></label>
                <label className="source"><span>来源扫描图 / 卡号</span><input value={clue.sourceRef ?? ""} onChange={(event) => updateClue(index, { sourceRef: event.target.value })} /></label>
              </div>
            </article>
          ))}
        </div>

        <div className="section-title compact"><div><p>PHASE MAP</p><h2>游戏阶段</h2></div></div>
        <div className="phase-map">
          {script.phases.map((phase, index) => <div key={phase.id}><span>{index + 1}</span><strong>{phase.name}</strong><small>{phase.objective}</small><em><Clock3 size={13} />{phase.durationMinutes} 分钟</em></div>)}
        </div>
      </section>
    </main>
  );
}

function CheckItem({ title, detail, tone }: { title: string; detail: string; tone: "ok" | "warning" | "error" }) {
  return <div className={`check-item ${tone}`}>{tone === "ok" ? <Check size={18} /> : <AlertTriangle size={18} />}<span><strong>{title}</strong><small>{detail}</small></span></div>;
}

function splitBriefContent(text: string) {
  const marker = text.search(/\n\*?游戏流程\*?\s*$/m);
  if (marker < 0) return { role: text, flow: "" };
  return { role: text.slice(0, marker).trim(), flow: text.slice(marker).trim() };
}

function flowSections(text: string) {
  const matches = [...text.matchAll(/>>([^<]+)<</g)];
  return matches.map((match, index) => ({
    title: match[1].trim(),
    text: text.slice(match.index ?? 0, matches[index + 1]?.index ?? text.length).trim(),
  }));
}

function removePageControlText(text: string) {
  return text
    .replace(/\n?晚宴结束前，请不要翻开下一页。?/g, "")
    .replace(/\n?第一幕流程结束前，请勿翻开下一页。?/g, "")
    .replace(/\n?※投票指认人类的时候，不管发生什么[^\n。]*[。]?/g, "")
    .replace(/\n?必须做到：你是一个演员，请不要念剧本！?/g, "")
    .replace(/\n?直到林夫人决定暂时结束调查[^。！]*[。！]?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function phaseBrief(text: string, phaseIndex: number, status: GameState["status"], scriptId?: string) {
  if (status === "lobby") return { role: "", flow: "" };
  const content = splitBriefContent(text);
  const lateStoryIndex = content.role.search(/>>(?:晚宴结束后[，,]?你的行踪|第二幕|第二阶段故事)<</);
  const roleLocked = scriptId === "xi-liangxi-phantom" ? phaseIndex < 2 : phaseIndex === 0;
  const role = roleLocked && lateStoryIndex >= 0 ? content.role.slice(0, lateStoryIndex).trim() : content.role;
  const sections = flowSections(content.flow);
  if (scriptId === "xi-liangxi-phantom") {
    const allowed = new Set(sections.slice(0, phaseIndex + 1).map((section) => section.title));
    return { role: removePageControlText(role), flow: removePageControlText(sections.filter((section) => allowed.has(section.title)).map((section) => section.text).join("\n\n")) };
  }
  const twoActFlow = sections.some((section) => section.title === "第一幕流程");
  const allowedTitles = twoActFlow
    ? new Set(sections.slice(0, phaseIndex + 1).map((section) => section.title))
    : phaseIndex === 1 ? new Set(["凶案之后"]) : phaseIndex === 2 ? new Set(["凶案之后", "谁是真凶"]) : phaseIndex >= 3 ? new Set(["凶案之后", "谁是真凶", "指认凶手"]) : new Set<string>();
  const flow = sections.filter((section) => allowedTitles.has(section.title)).map((section) => section.text).join("\n\n");
  return { role: removePageControlText(role), flow: removePageControlText(flow) };
}

function compactBriefParagraphs(text: string) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const heading = /^(?:【[^】]+】|>>[^<]+<<|\*游戏流程|※|必须做到)/.test(block);
    const list = /^\d+[、.]/.test(block);
    const previous = paragraphs[paragraphs.length - 1];
    if (!previous || heading || list || previous.length >= 280) {
      paragraphs.push(block);
      continue;
    }
    paragraphs[paragraphs.length - 1] = `${previous}${block}`;
  }
  return paragraphs;
}

function paginateBrief(text: string, limit = 900) {
  const blocks = compactBriefParagraphs(text);
  if (!blocks.length) return ["暂无可读密档内容。"];
  const pages: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (current && candidate.length > limit) {
      pages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) pages.push(current);
  return pages;
}

export function GameRoom({ script, game, playerId, onPlayerChange, onGameChange, onDraw, onTriggerSpecial, onAdvance, onNotice, canHost = true, canSwitchPlayers = true, onlinePlayerIds, availableDeckIds, searchOptions, specialTriggers, dmRoom, onConclusion, onVote, onSetLeader, onSetActOneAccusation }: {
  script: ScriptPackage; game: GameState; playerId: string; onPlayerChange: (id: string) => void;
  onGameChange: (state: GameState) => void; onDraw: (deckId: string, category?: ClueCategory, targetRoleId?: string, targetClueId?: string) => void; onTriggerSpecial?: (clueId: string) => void; onAdvance: () => void; onNotice: (message: string) => void;
  canHost?: boolean; canSwitchPlayers?: boolean; onlinePlayerIds?: string[]; availableDeckIds?: string[]; searchOptions?: Array<{ clueId: string; deckId: string; title: string }>; specialTriggers?: Array<{ clueId: string; title: string }>;
  dmRoom?: { roomCode: string; token: string };
  onConclusion?: (text: string) => void; onVote?: (roleId: string) => void; onSetLeader?: (roleId: string) => void; onSetActOneAccusation?: (roleId: string) => void;
}) {
  const [tab, setTab] = useState<"brief" | "clues" | "log">("brief");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("有什么需要确认的？我只会使用你目前有权看到的信息回答。");
  const [asking, setAsking] = useState(false);
  const [voteTarget, setVoteTarget] = useState("");
  const [briefPage, setBriefPage] = useState(0);
  const [briefView, setBriefView] = useState<"role" | "flow">("role");
  const [searchTargetRoleId, setSearchTargetRoleId] = useState("");
  const [searchTargetClueId, setSearchTargetClueId] = useState("");
  const [leaderTargetRoleId, setLeaderTargetRoleId] = useState("");
  const [actOneTargetRoleId, setActOneTargetRoleId] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const player = game.players.find((item) => item.id === playerId)!;
  const role = script.roles.find((item) => item.id === player.roleId)!;
  const leaderPlayer = game.players.find((item) => item.id === game.leaderPlayerId);
  const leaderRole = leaderPlayer ? script.roles.find((item) => item.id === leaderPlayer.roleId) : undefined;
  const actOneAccusationRole = script.roles.find((item) => item.id === game.actOneAccusationRoleId);
  const phase = script.phases[game.phaseIndex];
  const clues = script.clues.filter((clue) => player.clueIds.includes(clue.id) || game.publicClueIds.includes(clue.id));
  const votesSubmitted = game.players.filter((item) => item.voteRoleId).length;
  const votingPhase = phase.allowedActions.includes("vote");
  const voteResults = script.roles.map((candidate) => ({
    role: candidate,
    count: game.players.filter((item) => item.voteRoleId === candidate.id).length,
  })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  const winningRole = voteResults[0]?.role;
  const endingCondition = winningRole?.id === script.truth.culpritRoleId ? "solved" : script.id === "k2-dark-legend" && winningRole?.id === "gray" ? "framed" : "escaped";
  const ending = script.id === "xi-liangxi-phantom" && winningRole ? script.endings.find((item) => item.id === `vote-${winningRole.id}`) : script.endings.find((item) => item.condition === endingCondition);
  const triggerOptions = specialTriggers ?? availableSpecialTriggers(script, game, playerId);
  const gatedBrief = useMemo(() => phaseBrief(role.privateBrief, game.phaseIndex, game.status, script.id), [role.privateBrief, game.phaseIndex, game.status, script.id]);
  const briefPages = useMemo(() => paginateBrief(briefView === "role" ? gatedBrief.role : gatedBrief.flow), [gatedBrief, briefView]);
  const visibleSourcePages = useMemo(() => {
    if (game.status === "lobby" || !role.sourcePages?.length) return [];
    const limit = script.id === "xi-liangxi-phantom" ? (game.phaseIndex < 2 ? Math.min(13, role.sourcePages.length) : role.sourcePages.length) : game.phaseIndex === 0 ? Math.ceil(role.sourcePages.length * 0.6) : game.phaseIndex < script.phases.length - 1 ? Math.ceil(role.sourcePages.length * 0.9) : role.sourcePages.length;
    return role.sourcePages.slice(0, limit);
  }, [game.phaseIndex, game.status, role.sourcePages, script.phases.length]);
  const safeBriefPage = Math.min(briefPage, Math.max(0, briefPages.length - 1));
  const currentBriefPage = briefPages[safeBriefPage] ?? '暂无可读密档内容。';
  const briefLocked = game.status === "lobby";

  useEffect(() => {
    setBriefPage(0);
    setBriefView("role");
    setSearchTargetRoleId("");
    setSearchTargetClueId("");
    setSourceOpen(false);
  }, [role.id, game.phaseIndex, game.status]);

  function changeBriefView(view: "role" | "flow") {
    setBriefView(view);
    setBriefPage(0);
  }

  async function askDm(override?: string) {
    const prompt = (override ?? question).trim();
    if (!prompt) return;
    setAsking(true);
    try {
      const body = dmRoom ? { question: prompt, ...dmRoom } : { question: prompt, context: visibleContext(script, game, playerId) };
      const response = await fetch("/api/dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { answer?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "DM 暂时没有回应");
      setAnswer(result.answer || "没有可用回答");
      setQuestion("");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "DM 暂时没有回应");
    } finally {
      setAsking(false);
    }
  }

  function submitConclusion() {
    const conclusion = window.prompt("用一句话提交本轮公开结论");
    if (!conclusion?.trim()) return;
    if (onConclusion) {
      onConclusion(conclusion.trim());
      setTab("log");
      return;
    }
    onGameChange({ ...game, eventLog: [...game.eventLog, `${player.name}：${conclusion.trim()}`] });
    setTab("log");
  }

  function submitVote() {
    if (!voteTarget) return;
    if (player.voteRoleId) {
      onNotice("你已经完成最终指认");
      return;
    }
    if (onVote) return onVote(voteTarget);
    const target = script.roles.find((item) => item.id === voteTarget)!;
    const nextGame = {
      ...game,
      players: game.players.map((item) => item.id === playerId ? { ...item, voteRoleId: voteTarget } : item),
      eventLog: [...game.eventLog, `${player.name} 已完成最终指认：${target.name}`],
    };
    onGameChange(allVotesSubmitted(nextGame) ? { ...nextGame, status: "finished", eventLog: [...nextGame.eventLog, "所有玩家已完成最终指认，投票结束"] } : nextGame);
  }

  function setLeader() {
    if (!leaderTargetRoleId) return;
    if (onSetLeader) return onSetLeader(leaderTargetRoleId);
    const leader = game.players.find((item) => item.roleId === leaderTargetRoleId);
    if (leader) onGameChange({ ...game, leaderPlayerId: leader.id, eventLog: [...game.eventLog, `本幕 Leader 已确定：${leader.name}`] });
  }

  function setActOneAccusation() {
    if (!actOneTargetRoleId) return;
    if (onSetActOneAccusation) return onSetActOneAccusation(actOneTargetRoleId);
    const target = script.roles.find((item) => item.id === actOneTargetRoleId);
    if (target) onGameChange({ ...game, actOneAccusationRoleId: target.id, eventLog: [...game.eventLog, `第一幕指认结果已登记：${target.name}`] });
  }

  return (
    <main className="game-layout">
      <aside className="players-rail">
        <div className="room-code"><span>房间</span><strong>{game.roomCode}</strong></div>
        <div className="player-list">
          {game.players.map((item, index) => {
            const itemRole = script.roles.find((candidate) => candidate.id === item.roleId)!;
            const online = onlinePlayerIds ? onlinePlayerIds.includes(item.id) : true;
            return <button key={item.id} className={item.id === playerId ? "selected" : ""} disabled={!canSwitchPlayers} onClick={() => onPlayerChange(item.id)}><i>{index + 1}</i><span><strong>{item.name}</strong><small>{itemRole.name}</small></span><span className={online ? "online" : "offline"} /></button>;
          })}
        </div>
        <div className="privacy-note"><LockKeyhole size={16} /><span><strong>{canSwitchPlayers ? "玩家视角模拟" : "私密玩家视角"}</strong><small>{canSwitchPlayers ? "切换只用于本地测试。真实房间中每人只能看自己的页面。" : "服务端仅返回你的角色密档与已获得线索。"}</small></span></div>
      </aside>

      <section className="game-main">
        <div className="phase-header">
          <div className="phase-number">{String(game.phaseIndex + 1).padStart(2, "0")}</div>
          <div><p>当前阶段 · {game.status === "lobby" ? "等待开始" : game.status === "finished" ? "游戏结束" : "进行中"}</p><h1>{phase.name}</h1><span>{phase.objective}</span></div>
          <div className="phase-actions"><button className="secondary-button"><Clock3 size={17} />{phase.durationMinutes}:00</button>{game.status === "finished" ? <span className="waiting-host">游戏已结束</span> : canHost ? <button className="primary-button" onClick={onAdvance} disabled={votingPhase && !allVotesSubmitted(game)}>{game.status === "lobby" ? "开始游戏" : game.phaseIndex === script.phases.length - 1 ? `等待投票 ${votesSubmitted}/${game.players.length}` : "推进阶段"}<ChevronRight size={17} /></button> : <span className="waiting-host">等待房主推进</span>}</div>
        </div>

        <div className="dm-broadcast"><Bot size={24} /><div><strong>DM 广播</strong><p>{phase.hostPrompt}</p></div><span>系统触发</span></div>

        {script.id === "k2-dark-legend" && phase.id === "act-one" && game.status === "playing" ? <section className="leader-panel"><div><small>第一幕职责与指认</small><strong>{leaderPlayer && leaderRole ? `Leader：${leaderPlayer.name} · ${leaderRole.name}` : "等待登记 Leader"}</strong><span>{actOneAccusationRole ? `本幕指认：${actOneAccusationRole.name}` : "完成讨论后登记本幕指认结果"}。Leader 不参与随身物品搜查。</span></div>{canHost ? <div className="leader-controls"><div><select aria-label="选择 Leader" value={leaderTargetRoleId} onChange={(event) => setLeaderTargetRoleId(event.target.value)}><option value="">选择 Leader 角色</option>{script.roles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><button className="secondary-button" onClick={setLeader} disabled={!leaderTargetRoleId}>确认 Leader</button></div><div><select aria-label="选择第一幕指认对象" value={actOneTargetRoleId} onChange={(event) => setActOneTargetRoleId(event.target.value)}><option value="">选择本幕指认对象</option>{script.roles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><button className="secondary-button" onClick={setActOneAccusation} disabled={!actOneTargetRoleId}>登记指认</button></div></div> : null}</section> : null}

        <div className="workspace-tabs">
          <button className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}><KeyRound size={16} />角色密档</button>
          <button className={tab === "clues" ? "active" : ""} onClick={() => setTab("clues")}><Search size={16} />搜证与线索 <span>{clues.length}</span></button>
          <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}><MessageSquareText size={16} />公共记录</button>
        </div>

        {votingPhase ? <section className="final-vote-panel" aria-labelledby="final-vote-title">
          <div className="final-vote-head"><div><span>FINAL DECISION</span><h2 id="final-vote-title">最终指认</h2><p>每人选择一名怀疑对象并提交，全部玩家提交后投票结束。</p></div><strong>{votesSubmitted} / {game.players.length} 已提交</strong></div>
          <div className="final-vote-grid">{game.players.map((item) => { const itemRole = script.roles.find((candidate) => candidate.id === item.roleId)!; return <div key={item.id}><span>{item.name}</span><small>{item.voteRoleId ? "已提交" : "等待提交"}</small></div>; })}</div>
          <div className="final-vote-action"><select aria-label="选择指认角色" value={voteTarget} onChange={(event) => setVoteTarget(event.target.value)} disabled={Boolean(player.voteRoleId)}><option value="">选择你要指认的角色</option>{script.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary-button" onClick={submitVote} disabled={!voteTarget || Boolean(player.voteRoleId)}><Vote size={17} />{player.voteRoleId ? "已提交最终指认" : "提交最终指认"}</button></div>
        </section> : null}

        {game.status === "finished" ? <section className="game-result" aria-labelledby="game-result-title"><span>CASE CLOSED</span><h2 id="game-result-title">投票结束 · 真相公布</h2>{ending ? <div className="case-ending"><small>本局结局</small><h3>{ending.title}</h3><p>{ending.text}</p></div> : null}<div className="game-result-grid"><div><small>真凶</small><strong>{script.roles.find((item) => item.id === script.truth.culpritRoleId)?.name || "未识别"}</strong></div><div><small>作案手法</small><p>{script.truth.method}</p></div><div><small>动机</small><p>{script.truth.motive}</p></div></div><h3>投票结果</h3><div className="vote-results">{voteResults.map((item) => <div key={item.role.id}><span>{item.role.name}</span><strong>{item.count} 票</strong></div>)}</div></section> : null}

        {tab === "brief" ? (
          <div className="brief-sheet">
            <div className="brief-id"><span>角色编号 {script.roles.findIndex((item) => item.id === role.id) + 1}</span><h2>{role.name}</h2><p>{role.publicBio}</p>{visibleSourcePages.length ? <button className="secondary-button brief-source-button" onClick={() => setSourceOpen(true)}><FileSearch size={16} />原始扫描 <small>{visibleSourcePages.length} / {role.sourcePages?.length ?? 0} 张已开放</small></button> : null}</div>
            <div className="classified">
              <span><LockKeyhole size={15} />仅你可见</span>
              <div className="brief-view-tabs" role="tablist" aria-label="密档内容分类">
                <button className={briefView === "role" ? "active" : ""} onClick={() => changeBriefView("role")} role="tab" aria-selected={briefView === "role"}>角色内容</button>
                <button className={briefView === "flow" ? "active" : ""} onClick={() => changeBriefView("flow")} role="tab" aria-selected={briefView === "flow"}>游戏流程</button>
              </div>
              <h3>{briefView === "role" ? "私人经历" : "阶段规则与行动"}</h3>
              {briefLocked ? <div className="brief-locked"><LockKeyhole size={24} /><strong>{game.status === "lobby" ? "游戏开始后开放角色密档" : "当前阶段尚未开放这部分流程"}</strong><small>{game.status === "lobby" ? "请等待房主开始游戏。" : "房主推进到对应阶段后自动解锁。"}</small></div> : <><p className="brief-page-content">{currentBriefPage}</p><div className="brief-pagination" aria-label={`${briefView === "role" ? "角色内容" : "游戏流程"}分页`}><button className="icon-button" onClick={() => setBriefPage((page) => Math.max(0, page - 1))} disabled={safeBriefPage === 0} aria-label="上一页"><ArrowRight size={16} className="rotate-left" /></button><span>第 {safeBriefPage + 1} / {briefPages.length} 页</span><button className="icon-button" onClick={() => setBriefPage((page) => Math.min(briefPages.length - 1, page + 1))} disabled={safeBriefPage === briefPages.length - 1} aria-label="下一页"><ArrowRight size={16} /></button></div></>}
              {briefView === "role" && !briefLocked && game.phaseIndex >= 1 ? <><h3>你的任务</h3><ol>{role.objectives.map((objective) => <li key={objective}>{objective}</li>)}</ol></> : briefView === "flow" ? <p className="brief-view-note">流程内容按房主推进的阶段开放，未到时间的内容不会出现在分页中。</p> : null}
            </div>
          </div>
        ) : null}

        {tab === "clues" ? (
          <div className="clue-workspace">
            <div className="deck-list">
              {script.clueDecks.flatMap((deck) => {
                if (script.id === "k2-dark-legend" && phase.id === "act-two" && deck.id !== "rooms") return [];
                const owned = new Set(game.players.flatMap((item) => item.clueIds));
                const categories: ClueCategory[] = phase.name === "谁是真凶" ? ["role", "ship", "body"] : phase.name === "凶案之后" ? ["role", "ship"] : [];
                if (!categories.length) {
                  if (!phase.allowedActions.includes("search")) return [];
                  const used = clues.filter((clue) => clue.deckId === deck.id).length;
                  const hasAvailable = availableDeckIds ? availableDeckIds.includes(deck.id) : script.clues.some((clue) => clue.deckId === deck.id && script.phases.findIndex((item) => item.id === clue.availableFromPhase) <= game.phaseIndex && !owned.has(clue.id));
                  const enabled = used < deck.drawLimitPerPlayer && hasAvailable;
                  if (deck.id === "personal-items" && phase.id === "act-one") {
                    const canSearch = enabled && Boolean(game.leaderPlayerId) && game.leaderPlayerId !== player.id;
                    const searchStatus = used >= deck.drawLimitPerPlayer ? "本阶段已完成搜查" : !game.leaderPlayerId ? "等待房主登记 Leader" : game.leaderPlayerId === player.id ? "Leader 不参与本轮搜查" : "从另一组三人中选择一名角色";
                    return [<div className="targeted-draw" key={deck.id}><span><Map size={19} /><strong>{deck.name}</strong></span><small>{searchStatus}</small><select aria-label="选择搜查对象" value={searchTargetRoleId} onChange={(event) => setSearchTargetRoleId(event.target.value)} disabled={!canSearch}><option value="">选择搜查对象</option>{script.roles.filter((candidate) => candidate.id !== role.id && candidate.id !== leaderRole?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><button disabled={!canSearch || !searchTargetRoleId} onClick={() => onDraw(deck.id, undefined, searchTargetRoleId)}><Search size={16} />随机取得 1 件</button></div>];
                  }
                  if (deck.id === "rooms" && phase.id === "act-two") {
                    const choices = searchOptions ?? script.clues.filter((clue) => clue.deckId === deck.id && !owned.has(clue.id)).map((clue) => ({ clueId: clue.id, deckId: clue.deckId, title: clue.title }));
                    return [<div className="targeted-draw" key={deck.id}><span><Map size={19} /><strong>{deck.name}</strong></span><small>{used >= deck.drawLimitPerPlayer ? "本阶段已完成搜查" : "按角色密档限制选择一处地点"}</small><select aria-label="选择搜查地点" value={searchTargetClueId} onChange={(event) => setSearchTargetClueId(event.target.value)} disabled={!enabled}><option value="">选择搜查地点</option>{choices.map((choice) => <option key={choice.clueId} value={choice.clueId}>{choice.title}</option>)}</select><button disabled={!enabled || !searchTargetClueId} onClick={() => onDraw(deck.id, undefined, undefined, searchTargetClueId)}><Search size={16} />搜查此处</button></div>];
                  }
                  if (deck.id === "deep-investigation" && script.id === "xi-liangxi-phantom") {
                    const choices = searchOptions ?? script.clues.filter((clue) => clue.deckId === deck.id && !owned.has(clue.id)).map((clue) => ({ clueId: clue.id, deckId: clue.deckId, title: clue.title }));
                    return [<div className="targeted-draw" key={deck.id}><span><Map size={19} /><strong>{deck.name}</strong></span><small>仅按已获得线索卡上的编号指引开启</small><select aria-label="选择深入调查编号" value={searchTargetClueId} onChange={(event) => setSearchTargetClueId(event.target.value)} disabled={!hasAvailable}><option value="">选择指定编号</option>{choices.map((choice) => <option key={choice.clueId} value={choice.clueId}>{choice.title}</option>)}</select><button disabled={!hasAvailable || !searchTargetClueId} onClick={() => onDraw(deck.id, undefined, undefined, searchTargetClueId)}><Search size={16} />开启调查</button></div>];
                  }
                  return [<button key={deck.id} disabled={!enabled} onClick={() => onDraw(deck.id)}><span><Map size={19} /><strong>{deck.name}</strong></span><small>{hasAvailable ? `剩余 ${Math.max(0, deck.drawLimitPerPlayer - used)} 次` : "暂无可用线索"}</small><Search size={17} /></button>];
                }
                return categories.map((category) => {
                  const ownedCount = clues.filter((clue) => clueCategory(clue) === category).length;
                  const target = clueTarget(category, game.phaseIndex);
                  const quota = clueQuota(category, game.phaseIndex);
                  const hasAvailable = availableDeckIds ? availableDeckIds.includes(deck.id) : script.clues.some((clue) => clue.deckId === deck.id && clueCategory(clue) === category && script.phases.findIndex((item) => item.id === clue.availableFromPhase) <= game.phaseIndex && !owned.has(clue.id));
                  const enabled = phase.allowedActions.includes("search") && quota > 0 && ownedCount < target && hasAvailable;
                  const labels = { role: "角色随身物品", ship: "轮船线索", body: "尸体线索", special: "特殊线索" };
                  const status = !phase.allowedActions.includes("search") ? "当前阶段未开放" : ownedCount >= target ? "本阶段已抽完" : !hasAvailable ? "暂无可用线索" : `已抽 ${ownedCount} / ${target} 张`;
                  return <button key={`${deck.id}-${category}`} disabled={!enabled} onClick={() => onDraw(deck.id, category)}><span><Map size={19} /><strong>{labels[category]}</strong></span><small>{status} · 随机抽取</small><Search size={17} /></button>;
                });
              })}
            </div>
            {triggerOptions.length ? <section className="special-trigger-panel" aria-labelledby="special-trigger-title"><div><Sparkles size={18} /><div><strong id="special-trigger-title">可触发的特殊线索</strong><small>匹配线索持有人已满足条件，触发后参与者共同获得。</small></div></div><div>{triggerOptions.map((trigger) => <button key={trigger.clueId} className="secondary-button" onClick={() => onTriggerSpecial?.(trigger.clueId)} disabled={!onTriggerSpecial}><Sparkles size={16} />触发「{trigger.title}」</button>)}</div></section> : null}
            <div className="clue-grid">
              {clues.length ? clues.map((clue) => { const labels = { role: "角色随身物品", ship: "轮船线索", body: "尸体线索", special: "特殊线索" }; const sourceImage = clue.sourceRef?.startsWith("/") ? clue.sourceRef : ""; const isPublic = game.publicClueIds.includes(clue.id); const clueLabel = script.id === "xi-liangxi-phantom" ? script.clueDecks.find((deck) => deck.id === clue.deckId)?.name ?? "线索" : labels[clueCategory(clue)]; return <article key={clue.id}><div><Eye size={16} />{clueLabel} · {isPublic ? "公开线索" : "私人线索"}</div><h3>{clue.title}</h3>{sourceImage ? <a className="clue-source-image" href={sourceImage} target="_blank" rel="noreferrer" title="查看线索原图"><img src={sourceImage} alt={`${clue.title}原始扫描`} loading="lazy" decoding="async" /></a> : null}<p>{clue.content}</p><small className="clue-share-note">{isPublic ? "此卡按原规则向全员公开。" : "讨论时请口述或转述，不展示线索卡。"}</small></article>; }) : <div className="empty-clues"><Search size={30} /><strong>尚未获得线索</strong><span>进入搜证阶段后，从左侧分类中随机抽取。</span></div>}
            </div>
          </div>
        ) : null}

        {tab === "log" ? <div className="event-log">{game.eventLog.toReversed().map((event, index) => <div key={`${event}-${index}`}><span>{String(game.eventLog.length - index).padStart(2, "0")}</span><p>{event}</p></div>)}</div> : null}
      </section>

      <aside className="dm-panel">
        <div className="dm-title"><span><Bot size={19} /></span><div><strong>私人 AI DM</strong><small><i />只使用你的可见信息</small></div></div>
        <div className="dm-answer"><Bot size={18} /><p>{answer}</p></div>
        <div className="quick-questions">
          {["现在该做什么？", "我还能搜证吗？", "哪些信息可以公开？"].map((text) => <button key={text} onClick={() => setQuestion(text)}>{text}</button>)}
        </div>
        <div className="dm-input"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="单独向 DM 提问…" rows={3} /><button onClick={() => askDm()} disabled={asking || !question.trim()} aria-label="发送问题"><ArrowRight size={18} /></button></div>
        <div className="room-tools">
          <h3>本阶段工具</h3>
          {phase.allowedActions.includes("search") ? <button onClick={() => setTab("clues")}><Search size={17} />前往搜证</button> : null}
          <button onClick={() => askDm("请根据我当前可见的信息，给我一个不泄露答案的一级提示。") } disabled={asking}><CircleHelp size={17} />申请分级提示</button>
          <button onClick={submitConclusion}><UsersRound size={17} />提交讨论结论</button>
        </div>
      </aside>
      {sourceOpen && visibleSourcePages.length ? <div className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSourceOpen(false); }}><div className="source-modal-panel"><div className="source-modal-head"><div><span>SOURCE SCANS</span><h2 id="source-modal-title">{role.name} · 原始角色本</h2><p>扫描原图独立展示，已按当前阶段开放。</p></div><button className="icon-button" onClick={() => setSourceOpen(false)} aria-label="关闭原始扫描"><X size={18} /></button></div><div className="source-pages-grid">{visibleSourcePages.map((source, index) => <figure key={source}><a href={source} target="_blank" rel="noreferrer" title="在新标签页查看原图"><img src={source} alt={`${role.name}原始角色本扫描第${index + 1}张`} width={1600} height={1220} loading="lazy" decoding="async" /></a><figcaption>原始扫描第 {index + 1} 张</figcaption></figure>)}</div></div></div> : null}
    </main>
  );
}
