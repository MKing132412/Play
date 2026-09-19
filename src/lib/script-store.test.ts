import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sampleScript } from "./sample";
import { createStoredScript, deleteStoredScript, getStoredScript, listStoredScripts, updateStoredScript } from "./script-store";

const manifest = { fileCount: 2, totalBytes: 10, clueScanPaths: [], missingClueScanNumbers: [] };

test("script store reuses identical imports and versions changed source packages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mystery-scripts-"));
  try {
    const first = await createStoredScript({ fingerprint: "same", sourceName: "K1", script: sampleScript, manifest }, root);
    const duplicate = await createStoredScript({ fingerprint: "same", sourceName: "K1", script: sampleScript, manifest }, root);
    const changed = await createStoredScript({ fingerprint: "changed", sourceName: "K1", script: { ...sampleScript, title: "新版" }, manifest }, root);
    assert.equal(first.reused, false);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.record.id, first.record.id);
    assert.equal(changed.record.version, 2);
    assert.equal((await listStoredScripts(root)).length, 2);

    const updated = await updateStoredScript(first.record.id, { ...sampleScript, title: "已校对" }, root);
    assert.equal(updated?.script.title, "已校对");
    assert.equal((await getStoredScript(first.record.id, root))?.script.title, "已校对");
    assert.equal(await deleteStoredScript(first.record.id, root), true);
    assert.equal(await getStoredScript(first.record.id, root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
