export const maxImportBytes = 160 * 1024 * 1024;

export type ImportManifest = {
  fileCount: number;
  totalBytes: number;
  clueScanPaths: string[];
  missingClueScanNumbers: number[];
};

type ImportFile = Pick<File, "name" | "size" | "type"> & { webkitRelativePath?: string };

const supportedExtension = /\.(pdf|jpe?g|png|txt|json)$/i;
const imageExtension = /\.(jpe?g|png)$/i;
const junkName = /(免费获取更多剧本杀|5分钱打印)/i;

export function importPath(file: ImportFile) {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
}

export function nestedImportRoots(files: ImportFile[]) {
  const relativeParts = files.map((file) => importPath(file).split("/").filter(Boolean));
  if (relativeParts.some((parts) => parts.length < 2)) return [];

  // Directory selection prefixes every path with the selected folder. Identify
  // package prefixes by structure, rather than treating role folders as scripts.
  const packageMarker = /线索|规则|剧本说明|说明/i;
  const maxDepth = Math.max(...relativeParts.map((parts) => parts.length)) - 2;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const prefixes = new Set(relativeParts.map((parts) => parts.slice(0, depth + 1).join("/")));
    const candidates = [...prefixes].filter((prefix) => !packageMarker.test(prefix.split("/").at(-1) || ""));
    const markerCandidates = candidates.filter((prefix) => relativeParts.some((parts) => {
      if (parts.slice(0, depth + 1).join("/") !== prefix) return false;
      return packageMarker.test(parts[depth + 1] || "");
    }));
    if (markerCandidates.length > 1) {
      return markerCandidates.map((prefix) => prefix.split("/").at(-1)!).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
    }
    // Keep compatibility with packages that expose a marker as a direct file
    // (for example 规则.pdf) rather than a marker folder.
    const directFileCandidates = candidates.filter((prefix) => relativeParts.some((parts) => {
      if (parts.slice(0, depth + 1).join("/") !== prefix || parts.length !== depth + 2) return false;
      return packageMarker.test(parts[depth + 1] || "");
    }));
    const roots = directFileCandidates.length === 1 && candidates.length > 1 && candidates.every((prefix) => relativeParts.some((parts) => parts.slice(0, depth + 1).join("/") === prefix && parts.length === depth + 2))
      ? candidates
      : [];
    if (roots.length > 1) return roots
      .map((prefix) => prefix.split("/").at(-1)!)
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  }
  return [];
}

export function selectImportFiles<T extends ImportFile>(files: T[]) {
  const candidates = files.filter((file) => supportedExtension.test(file.name) && !junkName.test(file.name));
  const pdfNames = new Set(
    candidates
      .filter((file) => /\.pdf$/i.test(file.name))
      .map((file) => file.name.replace(/\.pdf$/i, "").toLocaleLowerCase()),
  );

  return candidates
    .filter((file) => {
      if (!imageExtension.test(file.name)) return true;
      const path = importPath(file);
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const parentName = parentPath.split("/").at(-1)?.toLocaleLowerCase() ?? "";
      return !pdfNames.has(parentName);
    })
    .sort((left, right) => importPath(left).localeCompare(importPath(right), "zh-CN", { numeric: true }));
}

export function buildImportManifest(files: ImportFile[], paths = files.map(importPath)): ImportManifest {
  const clueScanPaths = paths.filter((filePath) => /(^|\/)线索卡\/.*\.(jpe?g|png)$/i.test(filePath));
  const numbers = clueScanPaths
    .map((filePath) => Number(filePath.match(/(\d+)\.(?:jpe?g|png)$/i)?.[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
  const numberSet = new Set(numbers);
  const missingClueScanNumbers = numbers.length
    ? Array.from({ length: Math.max(...numbers) }, (_, index) => index + 1).filter((value) => !numberSet.has(value))
    : [];
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    clueScanPaths,
    missingClueScanNumbers,
  };
}
