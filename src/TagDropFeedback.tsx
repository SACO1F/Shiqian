import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { Check, LoaderCircle, Plus, Tag as TagIcon, X } from "lucide-react";
import { api, message, type Tag } from "./api";

type Point = {
  tagId: string;
  x: number;
  y: number;
  over: boolean;
  drop: boolean;
};
type Bounds = { left: number; top: number; width: number; height: number };
type Feedback = {
  phase: "drag" | "applying" | "success" | "error";
  tag: string;
  label: string;
  point: { x: number; y: number };
  bounds?: Bounds;
  fileId?: string;
};
type Annotation = { tagName: string; applied: number };

export function TagDropFeedback({
  tags,
  run,
  onNotify,
}: {
  tags: Tag[];
  run: (task: () => Promise<unknown>) => Promise<void>;
  onNotify: (text: string, error?: boolean) => void;
}) {
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const [feedback, setFeedback] = useState<Feedback>();
  useLayoutEffect(() => {
    if (!feedback?.fileId || feedback.phase === "drag") return;
    const card = document.querySelector<HTMLElement>(
      `[data-file-id="${CSS.escape(feedback.fileId)}"]`,
    );
    const r = card?.getBoundingClientRect();
    const next = r
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : undefined;
    const previous = feedback.bounds;
    if (
      next?.left !== previous?.left ||
      next?.top !== previous?.top ||
      next?.width !== previous?.width ||
      next?.height !== previous?.height
    )
      setFeedback((old) => (old ? { ...old, bounds: next } : old));
  });
  useEffect(() => {
    let target: HTMLElement | null = null;
    let pending = false;
    let dragging = false;
    let disposed = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTarget = () => {
      target?.classList.remove("tag-drop-target");
      target = null;
    };
    const reset = () => {
      if (!pending) {
        clearTarget();
        setFeedback(undefined);
      }
    };
    const finish = (next: Feedback) => {
      pending = false;
      clearTarget();
      if (disposed) return;
      setFeedback(next);
      clearTimeout(finishTimer);
      finishTimer = setTimeout(
        () => {
          if (!disposed) setFeedback(undefined);
        },
        next.phase === "error" ? 1800 : 1100,
      );
    };
    const subscriptions = [
      listen<Point>("tag-drag-point", ({ payload: p }) => {
        if (pending || disposed) return;
        clearTimeout(finishTimer);
        dragging = !p.drop && p.over;
        const card = p.over
          ? document
              .elementFromPoint(p.x, p.y)
              ?.closest<HTMLElement>("[data-file-id]") || null
          : null;
        if (card !== target) {
          clearTarget();
          target = card;
        }
        if (target && !target.classList.contains("tag-drop-target"))
          target.classList.add("tag-drop-target");
        const tag =
          tagsRef.current.find((t) => t.id === p.tagId)?.name || "标签";
        const r = card?.getBoundingClientRect();
        const next: Feedback = {
          phase: "drag",
          tag,
          label: card ? `松手添加「${tag}」` : "移到文件上",
          point: { x: p.x, y: p.y },
          bounds: r
            ? { left: r.left, top: r.top, width: r.width, height: r.height }
            : undefined,
          fileId: card?.dataset.fileId,
        };
        if (p.drop && p.over) {
          clearTarget();
          if (next.fileId) {
            pending = true;
            setFeedback({ ...next, phase: "applying", label: "正在标注…" });
            void run(async () => {
              try {
                const result = await api<Annotation>("annotation.apply", {
                  tagId: p.tagId,
                  ids: [next.fileId],
                });
                finish({
                  ...next,
                  phase: "success",
                  label: result.applied
                    ? `已添加「${result.tagName}」`
                    : "已有此标签",
                });
              } catch (e) {
                finish({ ...next, phase: "error", label: "标注失败，请重试" });
                throw e;
              }
            });
          } else {
            finish({ ...next, phase: "error", label: "请放到具体文件上" });
            void api("annotation.reject").catch((e) =>
              onNotify(message(e), true),
            );
          }
        } else if (p.over) setFeedback(next);
        else reset();
      }),
      listen("tag-drag-end", () => {
        dragging = false;
        clearTarget();
        setFeedback((old) => (old?.phase === "drag" ? undefined : old));
      }),
      listen<{ ok: boolean; result?: Annotation; error?: string }>(
        "annotation-result",
        ({ payload: p }) => {
          if (p.ok)
            onNotify(
              p.result?.applied
                ? `已添加「${p.result.tagName}」标注`
                : "文件已有此标签",
            );
          else onNotify(message(p.error), true);
        },
      ),
    ];
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragging && !pending) {
        e.preventDefault();
        e.stopImmediatePropagation();
        dragging = false;
        reset();
        void api("floating.cancel").catch(() => {});
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => {
      disposed = true;
      clearTarget();
      clearTimeout(finishTimer);
      document.removeEventListener("keydown", onEscape, true);
      subscriptions.forEach((p) => p.then((fn) => fn()));
    };
  }, [run, onNotify]);
  if (!feedback) return null;
  const icon =
    feedback.phase === "success" ? (
      <Check size={16} />
    ) : feedback.phase === "error" ? (
      <X size={16} />
    ) : feedback.phase === "applying" ? (
      <LoaderCircle size={16} className="spin" />
    ) : (
      <Plus size={16} />
    );
  const left = Math.max(12, Math.min(feedback.point.x + 20, innerWidth - 260));
  const top = Math.max(12, Math.min(feedback.point.y + 20, innerHeight - 64));
  return createPortal(
    <div
      className={`tag-drop-feedback phase-${feedback.phase} ${feedback.bounds ? "has-target" : "no-target"}`}
      aria-hidden="false"
    >
      {feedback.bounds && (
        <div
          className="tag-drop-frame"
          data-target-file={feedback.fileId}
          style={feedback.bounds}
        >
          <div className="tag-drop-target-label">
            {icon}
            <span>{feedback.label}</span>
          </div>
        </div>
      )}
      {feedback.phase === "drag" && (
        <div className="tag-drag-cursor" style={{ left, top }}>
          <TagIcon size={14} />
          <span>{feedback.tag}</span>
          {feedback.bounds ? <Plus size={13} /> : <X size={13} />}
        </div>
      )}
      <div className="tag-drop-announcement" role="status" aria-live="polite">
        {feedback.label}
      </div>
      {!feedback.bounds && feedback.phase !== "drag" && (
        <div className="tag-drag-cursor" style={{ left, top }}>
          {icon}
          {feedback.label}
        </div>
      )}
    </div>,
    document.body,
  );
}
