import { invoke } from "@tauri-apps/api/core";
export interface Tag {
  id: string;
  name: string;
  count: number;
  version: number;
  createdBy: "manual" | "folder" | "ai";
  accepted?: boolean;
  source: "manual" | "folder" | "ai" | "";
  ai?: { model: string; reason: string; updatedAt: number; confirmed: boolean };
}
export interface LocalFile {
  id: string;
  path: string;
  parent: string;
  name: string;
  extension: string;
  kind: string;
  bytes: number;
  modified: number;
  added: number;
  status: string;
  error: string;
  favorite: boolean;
  version: number;
  note: string;
  noteVersion: number;
  revision: string;
  identity: string;
  tags: Tag[];
  aiTask?: {
    status:
      "queued" | "running" | "done" | "failed" | "unsupported" | "cancelled";
    error: string;
    updatedAt: number;
  };
}
export interface Query {
  scope: string;
  text: string;
  include: string[];
  exclude: string[];
  mode: string;
  kinds: string[];
  status: string;
  directory: string;
  recursive: boolean;
  from?: number;
  to?: number;
  sort: string;
  direction: string;
  offset: number;
  limit: number;
}
export interface Results {
  files: LocalFile[];
  total: number;
  offset: number;
  hasMore: boolean;
}
export interface Bootstrap {
  tags: Tag[];
  counts: Record<string, number>;
  settings: {
    theme?: string;
    views?: Record<string, string>;
    density?: string;
    details?: boolean;
    galleryColumns?: number;
    sidebarCollapsed?: boolean;
    sidebarWidth?: number;
    floatingSize?: { width: number; height: number };
    floatingAlwaysOnTop?: boolean;
    folderAutoTagging?: boolean;
    ai?: AiConfig;
  };
  undoLabel?: string;
  dataPath: string;
  version: string;
  notice: string;
}
export interface AiConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  allowNewTags: boolean;
}
export interface ImportJob {
  id: string;
  discovered: number;
  processed: number;
  added: number;
  existing: number;
  skipped: number;
  failed: number;
  errors: string[];
  failedPaths: string[];
  done: boolean;
  cancelled: boolean;
}
export interface TransferTask {
  id: string;
  kind: string;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  result?: { path?: string; fileCount?: number; notice?: string };
}
export interface TransferStatus {
  busy: boolean;
  phase: string;
  bytes: number;
  totalBytes: number;
  completed: number;
  fileTotal: number;
  task?: TransferTask;
  history: TransferTask[];
}
export interface TaskSnapshot {
  transfer: TransferStatus;
  import?: ImportJob;
  ai: Record<string, number>;
}
export interface SupportSnapshot {
  lastBackup?: { createdAt: number; kind: string; path: string };
  notice: string;
}
export function api<T = Record<string, unknown>>(
  action: string,
  payload: unknown = {},
): Promise<T> {
  return invoke<T>("api", { action, payload });
}
export function message(error: unknown): string {
  return String(error).replace(/^[A-Z_]+:\s*/, "");
}
export const defaultQuery = (): Query => ({
  scope: "all",
  text: "",
  include: [],
  exclude: [],
  mode: "all",
  kinds: [],
  status: "",
  directory: "",
  recursive: true,
  sort: "added",
  direction: "desc",
  offset: 0,
  limit: 100,
});
export function versions(files: LocalFile[]) {
  return Object.fromEntries(files.map((f) => [f.id, f.version]));
}
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
export function date(ms: number): string {
  return ms
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(ms)
    : "—";
}
export const statusNames: Record<string, string> = {
  available: "可用",
  missing: "文件缺失",
  offline: "存储离线",
  inaccessible: "访问异常",
  unchecked: "等待检查",
};
export const kindNames: Record<string, string> = {
  image: "图片",
  pdf: "PDF",
  text: "文本",
  office: "Office",
  other: "其他",
};
