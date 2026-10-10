import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, Upload, FolderOpen, RefreshCw } from "lucide-react";
import { api, message, size, Tag, type TransferStatus } from "./api";
import { Modal } from "./components";
import { TaskGlyph } from "./TaskStatus";
import { TransferProgress } from "./TaskPanel";

type Preview = {
  fingerprint: string;
  fileCount: number;
  bytes: number;
  tagCount?: number;
  version?: string;
  missing?: string[];
  files: {
    name: string;
    tagCount: number;
    hasNote: boolean;
    favorite: boolean;
  }[];
};
type Result = { path: string; fileCount: number; notice?: string };
export function TransferDialog({
  mode,
  ids,
  tags,
  onClose,
  onImported,
}: {
  mode: "export" | "import";
  ids: string[];
  tags: Tag[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [tagId, setTagId] = useState("");
  const [path, setPath] = useState("");
  const [destination, setDestination] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("准备");
  const [processed, setProcessed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelAvailable, setCancelAvailable] = useState(false);
  const [status, setStatus] = useState<TransferStatus>();
  const lock = useRef(false);
  const request = useRef(0);
  const isExport = mode === "export";
  useEffect(() => {
    if (!isExport) return;
    const token = ++request.current;
    setPreview(undefined);
    setError("");
    api<Preview>("package.plan", { ids, tagId })
      .then((value) => {
        if (token === request.current) setPreview(value);
      })
      .catch((e) => {
        if (token === request.current) setError(message(e));
      });
    return () => {
      request.current++;
    };
  }, [isExport, ids, tagId]);
  useEffect(() => {
    if (!busy) return;
    let active = true;
    const timer = setInterval(() => {
      void api<TransferStatus>("package.status")
        .then((s) => {
          if (active) {
            setPhase(s.phase);
            setStatus(s);
            setProcessed(s.bytes);
            setCancelAvailable(s.busy);
          }
        })
        .catch(() => {});
    }, 400);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [busy]);
  async function choosePath() {
    try {
      const chosen = isExport
        ? await save({
            title: "保存资料包",
            defaultPath: "拾签资料.sqtagpack",
            filters: [{ name: "拾签资料包", extensions: ["sqtagpack"] }],
          })
        : await open({
            title: "选择资料包",
            multiple: false,
            filters: [{ name: "拾签资料包", extensions: ["sqtagpack"] }],
          });
      if (typeof chosen === "string") {
        setPath(chosen);
        if (!isExport) setPreview(undefined);
        setError("");
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function chooseDestination() {
    try {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: "选择接收文件的位置",
      });
      if (typeof chosen === "string") setDestination(chosen);
    } catch (e) {
      setError(message(e));
    }
  }
  async function inspect() {
    if (lock.current || !path.trim()) return;
    lock.current = true;
    setBusy(true);
    setCancelAvailable(false);
    setError("");
    setCancelling(false);
    setPhase("校验");
    setStatus(undefined);
    setProcessed(0);
    try {
      setPreview(await api<Preview>("package.inspect", { path }));
    } catch (e) {
      setPreview(undefined);
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start() {
    if (lock.current || !preview) return;
    lock.current = true;
    setBusy(true);
    setCancelAvailable(false);
    setError("");
    setCancelling(false);
    setPhase("准备");
    setStatus(undefined);
    setProcessed(0);
    try {
      const completed = await api<Result>(
        isExport ? "package.export" : "package.import",
        { ids, tagId, path, destination, fingerprint: preview.fingerprint },
      );
      setResult(completed);
      if (!isExport) onImported();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const missing = preview?.missing || [];
  return (
    <Modal
      title={isExport ? "导出资料包" : "导入资料包"}
      dismissDisabled={busy}
      onClose={onClose}
    >
      <div className="modal-content transfer-panel">
        {!result ? (
          <>
            <p className="muted">
              {isExport
                ? "原文件、标签、备注与收藏一起交接。"
                : "复制到新文件夹，并加入当前资料库。"}
            </p>
            {isExport && (
              <label className="transfer-field">
                <span>交接范围</span>
                <select
                  aria-label="资料包范围"
                  value={tagId}
                  disabled={busy || ids.length > 0}
                  onChange={(e) => setTagId(e.target.value)}
                >
                  <option value="">
                    {ids.length ? `所选 ${ids.length} 个文件` : "全部文件"}
                  </option>
                  {!ids.length &&
                    tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.count}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="transfer-field">
              <span>{isExport ? "资料包保存位置" : "资料包文件"}</span>
              <div className="export-destination">
                <input
                  aria-label="资料包路径"
                  value={path}
                  disabled={busy}
                  placeholder="选择或粘贴 .sqtagpack 路径"
                  onChange={(e) => {
                    setPath(e.target.value);
                    if (!isExport) setPreview(undefined);
                  }}
                />
                <button
                  className="button"
                  aria-label="选择资料包"
                  onClick={() => void choosePath()}
                  disabled={busy}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </label>
            {!isExport && (
              <>
                <button
                  className="button"
                  onClick={() => void inspect()}
                  disabled={busy || !path.trim()}
                >
                  <RefreshCw size={14} />
                  校验并预览
                </button>
                <label className="transfer-field">
                  <span>文件接收位置</span>
                  <div className="export-destination">
                    <input
                      aria-label="资料包接收目录"
                      value={destination}
                      disabled={busy}
                      placeholder="选择或粘贴文件夹路径"
                      onChange={(e) => setDestination(e.target.value)}
                    />
                    <button
                      className="button"
                      aria-label="选择资料包接收目录"
                      onClick={() => void chooseDestination()}
                      disabled={busy}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </label>
              </>
            )}
            {preview && (
              <div className="transfer-preview">
                <div className="transfer-counts">
                  <strong>{preview.fileCount} 个文件</strong>
                  <span>{size(preview.bytes)}</span>
                  {preview.tagCount !== undefined && (
                    <span>{preview.tagCount} 个标签</span>
                  )}
                </div>
                <details>
                  <summary>
                    查看文件清单{preview.fileCount > 100 ? "（前 100 项）" : ""}
                  </summary>
                  <ul>
                    {preview.files.map((f, i) => (
                      <li key={i}>
                        <span>{f.name}</span>
                        <small>
                          {f.tagCount} 标签{f.hasNote ? " · 备注" : ""}
                          {f.favorite ? " · 收藏" : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            {missing.length > 0 && (
              <div role="alert" className="tag-form-error">
                <p>
                  {missing.length} 个原文件缺失或变化，请刷新或重新关联后导出。
                </p>
                <details>
                  <summary>查看文件</summary>
                  {missing.map((name, i) => (
                    <p key={i}>{name}</p>
                  ))}
                </details>
              </div>
            )}
            <p className="subtle">
              {isExport
                ? "原文件保留，不包含 AI 配置。单包最多 10,000 个文件 / 8 GB。"
                : "同名标签复用；已有文件、备注与收藏保留。待确认 AI 标签继续待确认，导入不会触发 AI 识别。同一资料包只能导入一次。"}
            </p>
            {busy ? (
              <div className="transfer-working" role="status">
                {status ? (
                  <TransferProgress status={status} />
                ) : (
                  <>
                    <TaskGlyph status="working" />
                    <span>
                      {phase} · 已处理 {size(processed)}
                    </span>
                  </>
                )}
                <button
                  className="button quiet"
                  disabled={cancelling || !cancelAvailable}
                  onClick={() => {
                    setCancelling(true);
                    void api("package.cancel").catch((e) =>
                      setError(message(e)),
                    );
                  }}
                >
                  {cancelling ? "正在取消…" : "取消任务"}
                </button>
                <button className="button" onClick={onClose}>
                  后台运行
                </button>
              </div>
            ) : (
              <button
                className="button primary"
                onClick={() => void start()}
                disabled={
                  !preview ||
                  missing.length > 0 ||
                  !path.trim() ||
                  (!isExport && !destination.trim())
                }
              >
                {isExport ? <Download size={16} /> : <Upload size={16} />}{" "}
                {isExport ? "导出资料包" : "确认导入"}
              </button>
            )}
          </>
        ) : (
          <div role="status" className="export-result">
            <strong>
              {isExport ? "已导出" : "已导入"} {result.fileCount} 个文件
            </strong>
            <p className="export-path">{result.path}</p>
            {result.notice && <p>{result.notice}</p>}
            {!isExport && (
              <button
                className="button"
                onClick={() =>
                  void api("export.reveal", { path: result.path }).catch((e) =>
                    setError(message(e)),
                  )
                }
              >
                <FolderOpen size={16} />
                打开资料文件夹
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="tag-form-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
