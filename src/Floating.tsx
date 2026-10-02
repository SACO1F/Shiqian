import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Grip,
  ImagePlus,
  LoaderCircle,
  Plus,
  Settings2,
  Tag as TagIcon,
  Undo2,
  X,
} from "lucide-react";
import { api, Bootstrap, message, Tag } from "./api";
import "./floating.css";

type Presets = { ids: string[]; tags: Tag[] };
type Annotation = {
  tagName: string;
  applied: number;
  existing: number;
  imported: number;
  names: string[];
};
const colors = ["sage", "blue", "rose", "amber", "violet", "teal"];
function tone(id: string) {
  return colors[
    [...id].reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length
  ];
}

export default function Floating() {
  const [presets, setPresets] = useState<Presets>({ ids: [], tags: [] });
  const ref = useRef(presets);
  ref.current = presets;
  const [boot, setBoot] = useState<Bootstrap>();
  const [selected, setSelected] = useState("");
  const [manage, setManage] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragTag, setDragTag] = useState("");
  const [dropTag, setDropTag] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState({
    text: "标注留在本机，原文件保持原样。",
    error: false,
  });
  const gesture = useRef<
    { id: string; x: number; y: number; started: boolean } | undefined
  >(undefined);
  const notify = useCallback(
    (text: string, error = false) => setStatus({ text, error }),
    [],
  );
  const refresh = useCallback(async () => {
    const [p, b] = await Promise.all([
      api<Presets>("floating.presets"),
      api<Bootstrap>("bootstrap"),
    ]);
    setPresets(p);
    setBoot(b);
    setSelected((old) => (p.ids.includes(old) ? old : p.ids[0] || ""));
  }, []);
  const run = useCallback(
    async (task: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await task();
      } catch (e) {
        notify(message(e), true);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  const apply = useCallback(
    (tagId: string, paths: string[]) =>
      run(() => api("annotation.apply", { tagId, paths })),
    [run],
  );
  useEffect(() => {
    void refresh().catch((e) => notify(message(e), true));
    const win = getCurrentWebviewWindow();
    const subscriptions = [
      listen(
        "library-changed",
        () => void refresh().catch((e) => notify(message(e), true)),
      ),
      listen("tag-drag-end", () => {
        setDragTag("");
        gesture.current = undefined;
      }),
      listen<{ ok: boolean; result?: Annotation; error?: string }>(
        "annotation-result",
        ({ payload: p }) => {
          setDragTag("");
          if (!p.ok) {
            notify(message(p.error), true);
            return;
          }
          const r = p.result!;
          const target =
            r.names.length === 1 ? r.names[0] : `${r.names.length} 个文件`;
          notify(
            r.applied
              ? `已为 ${target} 添加「${r.tagName}」${r.imported ? "，并加入文件库" : ""}`
              : `${target} 已有「${r.tagName}」`,
          );
        },
      ),
      win.onCloseRequested((e) => {
        e.preventDefault();
        void api("floating.close");
      }),
      win.onDragDropEvent(async ({ payload: p }) => {
        if (p.type === "leave") {
          setIncoming(false);
          setDropTag("");
          return;
        }
        setIncoming(p.type !== "drop");
        const scale = await win.scaleFactor();
        const el = document
          .elementFromPoint(p.position.x / scale, p.position.y / scale)
          ?.closest<HTMLElement>("[data-preset-id]");
        const id = el?.dataset.presetId || "";
        setDropTag(p.type === "drop" ? "" : id);
        if (p.type === "drop") {
          if (id) void apply(id, p.paths);
          else
            notify(
              "请把文件放到一枚标签上；展开浮窗后可以看到所有预设。",
              true,
            );
        }
      }),
    ];
    return () => {
      subscriptions.forEach((p) => p.then((fn) => fn()));
    };
  }, [refresh, notify, apply]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      (document.documentElement.dataset.theme =
        !boot?.settings.theme || boot.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : boot.settings.theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [boot?.settings.theme]);
  const save = async (ids: string[]) => {
    await api("floating.save", { ids });
    await refresh();
  };
  const toggle = (tag: Tag) =>
    void run(() =>
      save(
        ref.current.ids.includes(tag.id)
          ? ref.current.ids.filter((id) => id !== tag.id)
          : [...ref.current.ids, tag.id],
      ),
    );
  const create = () =>
    void run(async () => {
      if (!name.trim()) return;
      if (ref.current.ids.length >= 24)
        throw Error("浮窗最多固定 24 个标签，请先移除一枚预设");
      const tag = await api<Tag>("tag.create", { name });
      await save([...new Set([...ref.current.ids, tag.id])]);
      setName("");
      notify(`已将「${tag.name}」加入预设`);
    });
  const choose = () =>
    void run(async () => {
      const paths = await open({
        multiple: true,
        directory: false,
        title: "选择需要标注的文件",
      });
      if (paths)
        await api("annotation.apply", {
          tagId: selected,
          paths: Array.isArray(paths) ? paths : [paths],
        });
    });
  const resize = () =>
    void run(async () => {
      await api("floating.resize", { collapsed: !collapsed });
      setCollapsed(!collapsed);
    });
  const pinned = presets.ids
    .map((id) => presets.tags.find((t) => t.id === id))
    .filter((t): t is Tag => !!t);
  return (
    <div
      className={`floating-shell ${collapsed ? "is-collapsed" : ""} ${incoming ? "receiving-files" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          void api("floating.cancel");
          gesture.current = undefined;
          setDragTag("");
          setManage(false);
        }
      }}
    >
      <header className="floating-titlebar">
        <div className="floating-handle" data-tauri-drag-region>
          <img src="/icon.svg" alt="" draggable={false} />
          <div data-tauri-drag-region>
            <strong data-tauri-drag-region>拾签</strong>
            <span data-tauri-drag-region>随手标注</span>
          </div>
        </div>
        <button
          className="float-icon"
          title="打开工作台"
          aria-label="打开工作台"
          onClick={() => void run(() => api("main.show"))}
        >
          <ArrowUpRight size={17} />
        </button>
        <button
          className="float-icon"
          title={collapsed ? "展开标签浮窗" : "收起标签浮窗"}
          aria-label={collapsed ? "展开标签浮窗" : "收起标签浮窗"}
          onClick={resize}
        >
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        <button
          className="float-icon"
          title="关闭浮窗"
          aria-label="关闭浮窗"
          onClick={() => void run(() => api("floating.close"))}
        >
          <X size={16} />
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="floating-intro">
            <div>
              <span className="float-eyebrow">
                {manage ? "MY PRESETS" : "QUICK TAGGING"}
              </span>
              <h1>{manage ? "自己的常用标签" : "把标签，贴到文件上"}</h1>
            </div>
            <button
              className={`float-icon ${manage ? "active" : ""}`}
              aria-label={manage ? "返回标签面板" : "管理预设标签"}
              title={manage ? "返回" : "管理预设"}
              onClick={() => setManage(!manage)}
            >
              {manage ? <Check size={18} /> : <Settings2 size={18} />}
            </button>
          </div>
          {manage ? (
            <section className="preset-editor">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <input
                  aria-label="新建预设标签"
                  placeholder="例如：项目 A、壁纸、待参考"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <button
                  className="float-add"
                  aria-label="创建并固定标签"
                  disabled={busy || !name.trim()}
                >
                  <Plus size={18} />
                </button>
              </form>
              <p>勾选常用标签 · {pinned.length}/24</p>
              <div className="preset-options">
                {presets.tags.map((tag) => (
                  <button
                    key={tag.id}
                    className="preset-option"
                    aria-pressed={presets.ids.includes(tag.id)}
                    disabled={busy}
                    onClick={() => toggle(tag)}
                  >
                    <span className={`tag-dot tone-${tone(tag.id)}`} />
                    <span>{tag.name}</span>
                    <span
                      className={`preset-check ${presets.ids.includes(tag.id) ? "checked" : ""}`}
                    >
                      {presets.ids.includes(tag.id) && <Check size={12} />}
                    </span>
                  </button>
                ))}
              </div>
              <small>取消勾选只会从浮窗移除，已有文件标注会保留。</small>
            </section>
          ) : (
            <>
              <p className="floating-guide">
                拖到桌面、资源管理器或拾签内的文件上
                <br />
                也可以将多个文件拖到下面的标签上
              </p>
              <div className="palette-chips" aria-label="预设标签">
                {pinned.map((tag) => (
                  <button
                    key={tag.id}
                    data-preset-id={tag.id}
                    className={`palette-chip tone-${tone(tag.id)} ${selected === tag.id ? "chosen" : ""} ${dropTag === tag.id ? "drop-active" : ""} ${dragTag === tag.id ? "drag-active" : ""}`}
                    aria-label={`标签：${tag.name}`}
                    aria-pressed={selected === tag.id}
                    title={`拖动「${tag.name}」到文件；点击选中后也可选择文件标注`}
                    disabled={busy}
                    onClick={() => setSelected(tag.id)}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      gesture.current = {
                        id: tag.id,
                        x: e.clientX,
                        y: e.clientY,
                        started: false,
                      };
                    }}
                    onPointerMove={(e) => {
                      const g = gesture.current;
                      if (
                        !g ||
                        g.started ||
                        Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5
                      )
                        return;
                      g.started = true;
                      setDragTag(tag.id);
                      setSelected(tag.id);
                      void api("floating.drag", { tagId: tag.id }).catch(
                        (error) => {
                          setDragTag("");
                          notify(message(error), true);
                        },
                      );
                    }}
                    onPointerUp={() => {
                      if (!gesture.current?.started)
                        gesture.current = undefined;
                    }}
                    onLostPointerCapture={() => {
                      if (!gesture.current?.started)
                        gesture.current = undefined;
                    }}
                  >
                    <TagIcon size={14} />
                    <span>{tag.name}</span>
                    <Grip size={13} className="tag-grip" />
                  </button>
                ))}
                <button
                  className="palette-chip add-preset"
                  onClick={() => setManage(true)}
                >
                  <Plus size={16} />
                  <span>预设标签</span>
                </button>
              </div>
              <div className="floating-assist">
                <button disabled={!selected || busy} onClick={choose}>
                  <ImagePlus size={15} />
                  <span>选择文件标注</span>
                </button>
                <span>
                  选中「
                  {presets.tags.find((t) => t.id === selected)?.name || "标签"}
                  」
                </span>
              </div>
            </>
          )}
          <footer
            className={`floating-status ${status.error && !dragTag ? "has-error" : ""}`}
            role="status"
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : dragTag ? (
              <TagIcon size={15} />
            ) : status.error ? (
              <span className="status-dot error" />
            ) : (
              <span className="status-dot" />
            )}
            <span>
              {dragTag
                ? "移到文件上松手标注 · Esc 取消"
                : incoming
                  ? "放到一枚标签上，即可完成标注"
                  : status.text}
            </span>
            {!dragTag && boot?.undoLabel && (
              <button
                className="float-icon"
                aria-label="撤销上一步标注操作"
                title={`撤销：${boot.undoLabel}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("undo");
                    notify("已撤销上一步操作");
                  })
                }
              >
                <Undo2 size={15} />
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
