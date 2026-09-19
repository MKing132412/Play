import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScriptPackage } from "./domain";
import type { ImportManifest } from "./import-files";

export type StoredScript = {
  id: string;
  fingerprint: string;
  sourceName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  script: ScriptPackage;
  manifest: ImportManifest;
};

export type ScriptSummary = Omit<StoredScript, "script" | "manifest"> & {
  title: string;
  synopsis: string;
  playerCount: number;
  estimatedMinutes: number;
  roleNames: string[];
  clueCount: number;
};

const scriptRoot = (override?: string) => override || process.env.SCRIPT_DATA_DIR || path.join(process.cwd(), "data", "scripts");
const recordPath = (id: string, override?: string) => path.join(scriptRoot(override), `${id}.json`);

async function ensureRoot(override?: string) {
  await mkdir(scriptRoot(override), { recursive: true });
}

export async function listStoredScripts(override?: string) {
  await ensureRoot(override);
  const names = (await readdir(/* turbopackIgnore: true */ scriptRoot(override))).filter((name) => name.endsWith(".json"));
  const records = await Promise.all(names.map(async (name) => {
    try {
      return JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ scriptRoot(override), name), "utf8")) as StoredScript;
    } catch {
      return null;
    }
  }));
  return records.filter((record): record is StoredScript => Boolean(record)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function summarizeScript(record: StoredScript): ScriptSummary {
  return {
    id: record.id,
    fingerprint: record.fingerprint,
    sourceName: record.sourceName,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    title: record.script.title,
    synopsis: record.script.synopsis,
    playerCount: record.script.playerCount,
    estimatedMinutes: record.script.estimatedMinutes,
    roleNames: record.script.roles.map((role) => role.name),
    clueCount: record.script.clues.length,
  };
}

export async function findStoredScriptByFingerprint(fingerprint: string, override?: string) {
  return (await listStoredScripts(override)).find((record) => record.fingerprint === fingerprint) ?? null;
}

export async function getStoredScript(id: string, override?: string) {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ recordPath(id, override), "utf8")) as StoredScript;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeRecord(record: StoredScript, override?: string) {
  await ensureRoot(override);
  const target = recordPath(record.id, override);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, target);
  return record;
}

export async function createStoredScript(input: Pick<StoredScript, "fingerprint" | "sourceName" | "script" | "manifest">, override?: string) {
  const existing = await findStoredScriptByFingerprint(input.fingerprint, override);
  if (existing) return { record: existing, reused: true };
  const versions = (await listStoredScripts(override)).filter((record) => record.sourceName === input.sourceName).map((record) => record.version);
  const now = new Date().toISOString();
  const record: StoredScript = {
    ...input,
    id: randomUUID(),
    version: Math.max(0, ...versions) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await writeRecord(record, override);
  return { record, reused: false };
}

export async function updateStoredScript(id: string, script: ScriptPackage, manifestOrOverride?: ImportManifest | string, override?: string) {
  const manifest = typeof manifestOrOverride === "string" ? undefined : manifestOrOverride;
  const dataRoot = typeof manifestOrOverride === "string" ? manifestOrOverride : override;
  const record = await getStoredScript(id, dataRoot);
  if (!record) return null;
  record.script = script;
  if (manifest) record.manifest = manifest;
  record.updatedAt = new Date().toISOString();
  return writeRecord(record, dataRoot);
}

export async function deleteStoredScript(id: string, override?: string) {
  const record = await getStoredScript(id, override);
  if (!record) return false;
  await rm(recordPath(id, override));
  return true;
}
