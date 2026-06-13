import { createInterface } from "node:readline";
import process from "node:process";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type FileItem = { relativePath: string; fileName: string };
type GrepMatch = {
  relativePath: string;
  lineNumber: number;
  byteOffset: number;
  lineContent: string;
  contextBefore?: string[];
  contextAfter?: string[];
};
type FileFinderApi = {
  waitForScan(timeoutMs?: number): Promise<Result<boolean>>;
  fileSearch(
    query: string,
    options?: { pageIndex?: number; pageSize?: number },
  ): Result<{ items: FileItem[]; scores: Array<{ total: number }> }>;
  grep(
    query: string,
    options?: {
      mode?: "plain" | "regex" | "fuzzy";
      pageSize?: number;
      beforeContext?: number;
      afterContext?: number;
      timeBudgetMs?: number;
    },
  ): Result<{
    items: GrepMatch[];
    totalMatched: number;
    totalFiles: number;
  }>;
  destroy(): void;
};

type SearchRequest = {
  id: string;
  kind: "files" | "content";
  query: string;
  limit?: number;
  mode?: "plain" | "regex" | "fuzzy";
  path?: string;
  beforeContext?: number;
  afterContext?: number;
};

export async function runFffSearchBridge(): Promise<void> {
  // The package publishes TypeScript sources with extensionless imports that
  // NodeNext rejects, while Bun resolves and bundles them correctly.
  const { FileFinder } = await import("@ff-labs/fff-bun") as {
    FileFinder: {
      create(options: {
        basePath: string;
        aiMode?: boolean;
        enableHomeDirScanning?: boolean;
        enableFsRootScanning?: boolean;
      }): Result<FileFinderApi>;
    };
  };
  const root = process.env.CHUMP_WORKSPACE_ROOT ?? process.cwd();
  const created = FileFinder.create({
    basePath: root,
    aiMode: true,
    enableHomeDirScanning: false,
    enableFsRootScanning: false,
  });
  if (!created.ok) {
    throw new Error(created.error);
  }

  const finder = created.value;
  await finder.waitForScan(10_000);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      let request: SearchRequest | undefined;
      try {
        request = JSON.parse(line) as SearchRequest;
        const result =
          request.kind === "files"
            ? searchFiles(finder, request)
            : searchContent(finder, request);
        writeResponse({ id: request.id, result });
      } catch (error) {
        writeResponse({
          id: request?.id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    finder.destroy();
  }
}

function searchFiles(
  finder: FileFinderApi,
  request: SearchRequest,
) {
  const found = finder.fileSearch(request.query.trim(), {
    pageIndex: 0,
    pageSize: clampLimit(request.limit, 20),
  });
  if (!found.ok) throw new Error(found.error);
  return found.value.items.map((item: FileItem, index: number) => ({
    path: item.relativePath.replaceAll("\\", "/"),
    name: item.fileName,
    score: found.value.scores[index]?.total ?? 0,
  }));
}

function searchContent(
  finder: FileFinderApi,
  request: SearchRequest,
) {
  const query = [request.path?.trim(), request.query.trim()].filter(Boolean).join(" ");
  const found = finder.grep(query, {
    mode: request.mode ?? "plain",
    pageSize: clampLimit(request.limit, 50),
    beforeContext: Math.max(0, request.beforeContext ?? 0),
    afterContext: Math.max(0, request.afterContext ?? 0),
    timeBudgetMs: 1_500,
  });
  if (!found.ok) throw new Error(found.error);
  return {
    matches: found.value.items.map((item: GrepMatch) => ({
      path: item.relativePath.replaceAll("\\", "/"),
      line: item.lineNumber,
      column: item.byteOffset,
      text: item.lineContent,
      before: item.contextBefore ?? [],
      after: item.contextAfter ?? [],
    })),
    totalMatched: found.value.totalMatched,
    totalFiles: found.value.totalFiles,
  };
}

function clampLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(value ?? fallback, 200));
}

function writeResponse(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
