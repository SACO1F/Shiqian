import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import {
  api,
  message,
  size,
  type ImportJob,
  type TaskSnapshot,
  type TransferStatus,
} from "./api";
import { ImportDetails } from "./components";
import { TaskGlyph } from "./TaskStatus";

export function useTasks(onError?: (text: string) => void) {
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  useEffect(() => {
    let active = true,
      polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await api<TaskSnapshot>("tasks.status");
        if (active) setSnapshot(value);
      } catch (error) {
        if (active && onError) onError(message(error));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onError]);
  return snapshot;
}
export function TransferProgress({ status }: { status: TransferStatus }) {
  const ratio =
    status.totalBytes > 0
      ? Math.min(1, status.bytes / status.totalBytes)
      : undefined;
  return (
    <div className="task-progress" role="status">
      <span>
        <TaskGlyph status="working" />
        {status.phase}
      </span>
      {ratio !== undefined && (
        <progress aria-label="当前阶段进度" max={1} value={ratio} />
      )}
      <small>
        {status.fileTotal > 0
          ? `${status.completed} / ${status.fileTotal} 个文件 · `
          : ""}
        {size(status.bytes)}
        {status.totalBytes > 0 ? ` / ${size(status.totalBytes)}` : ""}
      </small>
    </div>
  );
}
const names: Record<string, string> = {
  "package.inspect": "校验资料包",
  "package.export": "导出资料包",
  "package.import": "导入资料包",
  "backup.restore": "恢复标注备份",
};
const states: Record<string, string> = {
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
  running: "进行中",
};
export function TaskPanel({
  snapshot,
  onRetryImport,
}: {
  snapshot?: TaskSnapshot;
  onRetryImport: (paths: string[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!snapshot)
    return (
      <div className="modal-content" role="status">
        正在读取任务…
      </div>
    );
  const { transfer, ai } = snapshot;
  const imported: ImportJob | undefined = snapshot.import;
  return (
    <div className="modal-content task-panel">
      {transfer.busy && (
        <section>
          <h3>{names[transfer.task?.kind || ""] || "资料包任务"}</h3>
          <TransferProgress status={transfer} />
          {transfer.task?.kind !== "backup.restore" && (
            <button
              className="button quiet"
              disabled={busy}
              onClick={() => void run(() => api("package.cancel"))}
            >
              取消任务
            </button>
          )}
        </section>
      )}
      {imported && (
        <section>
          <h3>文件加入</h3>
          <ImportDetails
            job={imported}
            onRetry={() => run(() => onRetryImport(imported.failedPaths || []))}
            busy={busy || transfer.busy}
          />
          {!imported.done && (
            <button
              className="button quiet"
              disabled={busy}
              onClick={() => void run(() => api("import.cancel"))}
            >
              停止加入
            </button>
          )}
        </section>
      )}
      <section>
        <h3>AI 分析</h3>
        <p className="muted">
          等待 {ai.queued || 0} · 处理中 {ai.running || 0} · 完成 {ai.done || 0}{" "}
          · 失败 {ai.failed || 0}
        </p>
        {ai.failed > 0 && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(() => api("ai.retry_failed"))}
          >
            <RefreshCw size={14} />
            重试失败项
          </button>
        )}
        {(ai.queued || ai.running) > 0 && (
          <button
            className="button quiet"
            disabled={busy}
            onClick={() => void run(() => api("ai.cancel"))}
          >
            取消等待与处理中的识别
          </button>
        )}
      </section>
      <section>
        <h3>最近资料包任务</h3>
        <p className="subtle">本次运行，保留最近 12 项。</p>
        {!transfer.history.length && <p className="muted">暂无记录</p>}
        {transfer.history.map((task) => (
          <article className="task-record" key={task.id}>
            <div>
              <TaskGlyph
                status={
                  task.state === "failed"
                    ? "error"
                    : task.state === "cancelled"
                      ? "cancelled"
                      : "done"
                }
              />
              <strong>{names[task.kind] || "资料包任务"}</strong>
              <span>{states[task.state]}</span>
              <small>
                {new Date(task.startedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </div>
            {task.result?.fileCount !== undefined && (
              <p>{task.result.fileCount} 个文件</p>
            )}
            {task.result?.notice && <p>{task.result.notice}</p>}
            {task.error && (
              <p className="tag-form-error">{message(task.error)}</p>
            )}
            {task.state === "done" &&
              task.kind === "package.import" &&
              task.result?.path && (
                <button
                  className="button quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api("export.reveal", { path: task.result?.path }),
                    )
                  }
                >
                  <FolderOpen size={14} />
                  打开接收文件夹
                </button>
              )}
          </article>
        ))}
      </section>
      {error && (
        <p role="alert" className="tag-form-error">
          {error}
        </p>
      )}
    </div>
  );
}
