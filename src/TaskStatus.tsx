import { AlertCircle, Check, Clock3, Minus, Sparkles } from "lucide-react";
import type { LocalFile } from "./api";

export function TaskGlyph({
  status,
}: {
  status: "working" | "done" | "error" | "waiting" | "cancelled" | "review";
}) {
  if (status === "working")
    return (
      <span className="task-lattice" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 75}ms` }} />
        ))}
      </span>
    );
  const Icon = {
    done: Check,
    error: AlertCircle,
    waiting: Clock3,
    cancelled: Minus,
    review: Sparkles,
  }[status];
  return <Icon className="task-glyph" size={14} aria-hidden="true" />;
}

export function AiTaskStatus({
  files,
  busy,
  onCancel,
}: {
  files: LocalFile[];
  busy: boolean;
  onCancel: () => void;
}) {
  const counts: Record<string, number> = {};
  for (const file of files)
    if (file.aiTask)
      counts[file.aiTask.status] = (counts[file.aiTask.status] || 0) + 1;
  const pending = files.reduce(
    (n, file) =>
      n + file.tags.filter((t) => t.source === "ai" && !t.ai?.confirmed).length,
    0,
  );
  const active = (counts.queued || 0) + (counts.running || 0);
  if (!Object.keys(counts).length && !pending) return null;
  const task = files.length === 1 ? files[0].aiTask : undefined;
  const status = active
    ? counts.running
      ? "working"
      : "waiting"
    : counts.failed
      ? "error"
      : pending
        ? "review"
        : counts.cancelled
          ? "cancelled"
          : counts.unsupported
            ? "waiting"
            : "done";
  const singleLabels = {
    queued: "等待 AI 分析",
    running: "AI 正在分析",
    done: pending ? `${pending} 个 AI 标签待确认` : "AI 标注已更新",
    failed: "AI 分析失败，可重新识别",
    unsupported: "暂不支持此文件内容",
    cancelled: "AI 分析已取消",
  };
  const text =
    files.length === 1
      ? task
        ? singleLabels[task.status]
        : `${pending} 个 AI 标签待确认`
      : [
          counts.queued && `等待 ${counts.queued}`,
          counts.running && `处理中 ${counts.running}`,
          counts.done && `完成 ${counts.done}`,
          counts.failed && `失败 ${counts.failed}`,
          counts.unsupported && `未支持 ${counts.unsupported}`,
          counts.cancelled && `已取消 ${counts.cancelled}`,
          pending && `待确认标签 ${pending}`,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div
      className={`ai-task-status status-${task?.status || status}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-task-state={status}
    >
      <span className="task-state-line" key={status}>
        <TaskGlyph status={status} />
        <span>{text}</span>
      </span>
      {active > 0 && (
        <button
          className="quiet-link task-cancel"
          disabled={busy}
          onClick={onCancel}
          title="仅取消所选文件的任务；已发送的请求结束后丢弃结果"
        >
          取消识别
        </button>
      )}
      {task?.error && <small>{task.error.replace(/^[A-Z_]+:\s*/, "")}</small>}
    </div>
  );
}
