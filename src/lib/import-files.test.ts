import assert from "node:assert/strict";
import test from "node:test";
import { buildImportManifest, importPath, nestedImportRoots, selectImportFiles } from "./import-files";

const file = (path: string, size = 1) => ({
  name: path.split("/").at(-1)!,
  size,
  type: "",
  webkitRelativePath: path,
});

test("import manifest reports clue scan coverage and missing sequence numbers", () => {
  const files = [file("剧本/线索卡/001.jpg", 3), file("剧本/线索卡/003.jpg", 5), file("剧本/规则.pdf", 7)];
  assert.deepEqual(buildImportManifest(files), {
    fileCount: 3,
    totalBytes: 15,
    clueScanPaths: ["剧本/线索卡/001.jpg", "剧本/线索卡/003.jpg"],
    missingClueScanNumbers: [2],
  });
});

test("folder import detects a parent containing multiple script packages", () => {
  assert.deepEqual(nestedImportRoots([
    file("四个剧本/K1-游轮迷影/角色.pdf"),
    file("四个剧本/K2-黑夜传说/规则.pdf"),
  ]), ["K1-游轮迷影", "K2-黑夜传说"]);
  assert.deepEqual(nestedImportRoots([file("K1-游轮迷影/角色.pdf"), file("K1-游轮迷影/线索卡/001.jpg")]), []);
});

test("folder import accepts one script whose role folders sit beside clue and rules folders", () => {
  assert.deepEqual(nestedImportRoots([
    file("K1-游轮迷影/安乡/角色.pdf"),
    file("K1-游轮迷影/线索卡/001.jpg"),
    file("K1-游轮迷影/游戏规则/规则.pdf"),
  ]), []);
});

test("folder import keeps PDFs and unique folders without uploading duplicate page images", () => {
  const selected = selectImportFiles([
    file("剧本/白书云/010.jpg"),
    file("剧本/线索卡/002.jpg"),
    file("剧本/白书云.pdf"),
    file("剧本/线索卡/001.jpg"),
    file("剧本/免费获取更多剧本杀.txt"),
    file("剧本/5分钱打印-首单免费.jpg"),
    file("剧本/不支持.docx"),
  ]);

  assert.deepEqual(selected.map(importPath), ["剧本/白书云.pdf", "剧本/线索卡/001.jpg", "剧本/线索卡/002.jpg"]);
});

test("folder import removes page images when matching PDFs are stored in another folder", () => {
  const selected = selectImportFiles([
    file("剧本/游戏规则/白书云.pdf"),
    file("剧本/白书云/001.jpg"),
    file("剧本/线索卡/001.jpg"),
  ]);
  assert.deepEqual(selected.map(importPath), ["剧本/线索卡/001.jpg", "剧本/游戏规则/白书云.pdf"]);
});
