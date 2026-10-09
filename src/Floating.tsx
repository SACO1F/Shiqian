import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  Trash2,
  Minus,
  ImagePlus,
  LoaderCircle,
  Plus,
  Pin,
  PinOff,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { api, Bootstrap, message, Tag } from "./api";
import { Modal } from "./components";
import { ExportTagDialog } from "./ExportTagDialog";
import { FloatingResizeHandles } from "./FloatingResizeHandles";
import { useFloatingHistory } from "./useFloatingHistory";
import "./floating.css";
import { tagTone } from "./tagColors";
import { useTagArrival, reducedMotion } from "./microMotion";
import { FloatingHistory } from "./FloatingHistory";
import { TaskGlyph } from "./TaskStatus";

type Presets = { ids: string[]; tags: Tag[] };
type WindowOptions = { collapsed: boolean; alwaysOnTop: boolean };
type Annotation = {
  tagName: string;
  applied: number;
  existing: number;
  imported: number;
  names: string[];
};

export default function Floating() {
  const [presets, setPresets] = useState<Presets>({ ids: [], tags: [] });
  const ref = useRef(presets);
  const paletteScroll = useRef<HTMLDivElement>(null);
  ref.current = presets;
  const [boot, setBoot] = useState<Bootstrap>();
  const {
    operations,
    record,
    ready: historyReady,
  } = useFloatingHistory(boot?.dataPath);
  useTagArrival(
    paletteScroll,
    boot?.dataPath,
    presets.tags.filter((tag) => presets.ids.includes(tag.id)),
  );
  const [menuClosing, setMenuClosing] = useState(false);
  const menuTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(menuTimer.current), []);
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{
    tag: Tag;
    mode: "rename" | "delete";
  }>();
  const [menu, setMenu] = useState<{ tag: Tag; x: number; y: number }>();
  const menuSurface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu && !menuClosing)
      menuSurface.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
  }, [menu, menuClosing]);
  const [exportTag, setExportTag] = useState<Tag>();
  function highlightMenu(event: React.SyntheticEvent<HTMLDivElement>) {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      '[role="menuitem"]',
    );
    if (!item || (item as HTMLButtonElement).disabled) return;
    const highlight =
      event.currentTarget.querySelector<HTMLElement>(".menu-glide");
    if (highlight)
      Object.assign(highlight.style, {
        transform: `translateY(${item.offsetTop}px)`,
        height: `${item.offsetHeight}px`,
        opacity: "1",
      });
  }
  function dismissMenu() {
    if (menuTimer.current) return;
    const finish = () => {
      setMenu(undefined);
      setMenuClosing(false);
      menuTrigger.current?.focus();
      menuTimer.current = undefined;
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    setMenuClosing(true);
    menuTimer.current = setTimeout(finish, 140);
  }
  const actionLock = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragTag, setDragTag] = useState("");
  const [dropTag, setDropTag] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState({
    text: "就绪",
    error: false,
  });
  const gesture = useRef<
    { id: string; x: number; y: number; started: boolean } | undefined
  >(undefined);
  const notify = useCallback(
    (text: string, error = false, log = false) => {
      setStatus({ text, error });
      if (log) record(text);
    },
    [record],
  );
  const refresh = useCallback(async () => {
    const [p, b, options] = await Promise.all([
      api<Presets>("floating.presets"),
      api<Bootstrap>("bootstrap"),
      api<WindowOptions>("floating.state"),
    ]);
    setPresets(p);
    setBoot(b);
    setCollapsed(options.collapsed);
    setAlwaysOnTop(options.alwaysOnTop);
    setSelected((old) => (p.ids.includes(old) ? old : p.ids[0] || ""));
  }, []);
  const run = useCallback(
    async (task: () => Promise<unknown>) => {
      if (actionLock.current) return;
      actionLock.current = true;
      setBusy(true);
      try {
        await task();
      } catch (e) {
        notify(message(e), true);
      } finally {
        actionLock.current = false;
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
            false,
            true,
          );
        },
      ),
      win.onCloseRequested((e) => {
        e.preventDefault();
        void api("floating.close");
      }),
      win.onResized(() => setMenu(undefined)),
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
          else notify("请将文件放到标签上", true);
        }
      }),
    ];
    return () => {
      subscriptions.forEach((p) => p.then((fn) => fn()));
    };
  }, [refresh, notify, apply]);
  useEffect(() => {
    document.documentElement.classList.add("floating-window");
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const effective =
        !boot?.settings.theme || boot.settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : boot.settings.theme;
      document.documentElement.dataset.theme = effective;
      void api("theme.sync", { theme: effective }).catch((error) =>
        notify(message(error), true),
      );
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [boot?.settings.theme]);
  const save = async (ids: string[]) => {
    await api("floating.save", { ids });
    await refresh();
  };
  const pin = (tag: Tag) =>
    void run(async () => {
      await save([...new Set([...ref.current.ids, tag.id])]);
      setAdding(false);
      setName("");
      notify(`已添加「${tag.name}」`, false, true);
    });
  const create = () =>
    void run(async () => {
      if (!name.trim()) return;
      const tag = await api<Tag>("tag.create", { name: name.trim() });
      await save([...new Set([...ref.current.ids, tag.id])]);
      setName("");
      setAdding(false);
      notify(`已添加「${tag.name}」`, false, true);
    });
  const changeTag = () =>
    void run(async () => {
      if (!editing || (editing.mode === "rename" && !name.trim())) return;
      await api(editing.mode === "rename" ? "tags.rename" : "tags.delete", {
        id: editing.tag.id,
        version: editing.tag.version,
        name: name.trim(),
      });
      setEditing(undefined);
      await refresh();
      notify(
        editing.mode === "rename"
          ? `已将「${editing.tag.name}」改为「${name.trim()}」`
          : `已删除「${editing.tag.name}」`,
        false,
        true,
      );
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
        if (e.key === "Escape" && !adding && !editing && !exportTag) {
          void api("floating.cancel");
          gesture.current = undefined;
          setDragTag("");
          if (menu) dismissMenu();
        }
      }}
    >
      {!collapsed && (
        <FloatingResizeHandles
          onError={(error) => notify(message(error), true)}
        />
      )}
      <header className="floating-titlebar">
        <div className="floating-handle" data-tauri-drag-region>
          <img src="/icon.svg" alt="" draggable={false} />
          <div data-tauri-drag-region>
            <strong data-tauri-drag-region>拾签</strong>
          </div>
        </div>
        <button
          className={`float-icon float-pin ${alwaysOnTop ? "is-pinned" : ""}`}
          title={alwaysOnTop ? "取消置顶" : "置顶浮窗"}
          aria-label={alwaysOnTop ? "取消置顶" : "置顶浮窗"}
          aria-pressed={alwaysOnTop}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api("floating.topmost", { value: !alwaysOnTop });
              setAlwaysOnTop(!alwaysOnTop);
            })
          }
        >
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
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
          disabled={busy}
          onClick={resize}
        >
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        <button
          className="float-icon"
          title="关闭浮窗"
          aria-label="关闭浮窗"
          disabled={busy}
          onClick={() => void run(() => api("floating.close"))}
        >
          <X size={16} />
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="floating-intro">
            <h1>常用标签</h1>
            <small>{pinned.length}</small>
          </div>
          <p className="floating-guide">拖动标签标注文件 · 九宫格编辑</p>
          <div className="palette-stage">
            <div
              className="palette-chips"
              aria-label="常用标签"
              ref={paletteScroll}
            >
              {pinned.map((tag) => (
                <div
                  key={tag.id}
                  data-preset-id={tag.id}
                  data-motion-tag={tag.id}
                  className={`palette-chip tag-color tone-${tagTone(tag.id)} ${selected === tag.id ? "chosen" : ""} ${dropTag === tag.id ? "drop-active" : ""} ${dragTag === tag.id ? "drag-active" : ""}`}
                >
                  <button
                    className="palette-tag"
                    aria-label={`标签：${tag.name}`}
                    aria-pressed={selected === tag.id}
                    title={`拖动「${tag.name}」到文件`}
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
                  </button>
                  <button
                    className="tag-more"
                    aria-label={`管理标签${tag.name}`}
                    title="修改、导出或删除"
                    aria-haspopup="menu"
                    aria-expanded={menu?.tag.id === tag.id}
                    disabled={busy}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      clearTimeout(menuTimer.current);
                      menuTimer.current = undefined;
                      setMenuClosing(false);
                      menuTrigger.current = e.currentTarget;
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu({
                        tag,
                        x: Math.min(r.right - 184, innerWidth - 196),
                        y: Math.min(r.bottom + 5, innerHeight - 240),
                      });
                    }}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 15 15"
                      aria-hidden="true"
                    >
                      {Array.from({ length: 9 }, (_, i) => (
                        <circle
                          key={i}
                          cx={3 + (i % 3) * 4.5}
                          cy={3 + Math.floor(i / 3) * 4.5}
                          r="1"
                          fill="currentColor"
                        />
                      ))}
                    </svg>
                  </button>
                </div>
              ))}
              {!pinned.length && (
                <p className="floating-empty">添加常用标签，开始标注</p>
              )}
            </div>
            <button
              className="glass-add"
              aria-label="添加标签"
              disabled={busy}
              onWheel={(e) => {
                const list = paletteScroll.current;
                if (list)
                  list.scrollBy(
                    0,
                    e.deltaY *
                      (e.deltaMode === 1
                        ? 16
                        : e.deltaMode === 2
                          ? list.clientHeight
                          : 1),
                  );
              }}
              onClick={() => {
                setName("");
                setAdding(true);
                notify("就绪");
              }}
            >
              <Plus size={15} />
              添加标签
            </button>
          </div>
          <div className="floating-assist">
            <button
              disabled={!selected || busy}
              onClick={choose}
              title={presets.tags.find((t) => t.id === selected)?.name}
            >
              <ImagePlus size={15} />
              选择文件标注
            </button>
          </div>
          {(busy || dragTag || incoming || status.error) && (
            <div
              className={`floating-status ${status.error && !dragTag ? "has-error" : ""}`}
              role="status"
            >
              {busy ? (
                <TaskGlyph status="working" />
              ) : dragTag ? (
                <TagIcon size={15} />
              ) : (
                <span className={`status-dot ${status.error ? "error" : ""}`} />
              )}
              <span>
                {busy && !dragTag
                  ? "正在处理…"
                  : dragTag
                    ? "移到文件上松手 · Esc 取消"
                    : incoming
                      ? "放到标签上完成标注"
                      : status.text}
              </span>
            </div>
          )}
          <FloatingHistory operations={operations} ready={historyReady} />
        </>
      )}
      {menu && (
        <>
          <button
            className="float-menu-dismiss"
            aria-label="关闭标签菜单"
            onClick={dismissMenu}
          />
          <div
            ref={menuSurface}
            className={`float-tag-menu ${menuClosing ? "is-closing" : ""}`}
            inert={menuClosing}
            aria-hidden={menuClosing || undefined}
            role="menu"
            aria-label={`标签${menu.tag.name}的操作`}
            style={{ left: Math.max(12, menu.x), top: Math.max(66, menu.y) }}
            onPointerOver={highlightMenu}
            onFocusCapture={highlightMenu}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                dismissMenu();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ),
                ];
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            <span className="menu-glide" aria-hidden="true" />
            <strong>{menu.tag.name}</strong>
            <button
              role="menuitem"
              autoFocus
              onClick={() => {
                menuTrigger.current?.focus();
                setEditing({ tag: menu.tag, mode: "rename" });
                setName(menu.tag.name);
                setMenu(undefined);
                notify("就绪");
              }}
            >
              <Edit3 size={14} />
              修改名称
            </button>
            <button
              role="menuitem"
              disabled={menu.tag.count === 0}
              onClick={() => {
                menuTrigger.current?.focus();
                setExportTag(menu.tag);
                setMenu(undefined);
              }}
            >
              <Download size={14} />
              导出标签文件
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const tag = menu.tag;
                setMenu(undefined);
                void run(async () => {
                  await save(ref.current.ids.filter((id) => id !== tag.id));
                  notify(`已从浮窗移除「${tag.name}」`, false, true);
                });
              }}
            >
              <Minus size={14} />
              从浮窗移除
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                menuTrigger.current?.focus();
                setEditing({ tag: menu.tag, mode: "delete" });
                setMenu(undefined);
                notify("就绪");
              }}
            >
              <Trash2 size={14} />
              删除标签
            </button>
          </div>
        </>
      )}
      {adding && (
        <Modal
          title="添加标签"
          dismissDisabled={busy}
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <div className="modal-content float-editor">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <input
                autoFocus
                aria-label="标签名称"
                placeholder="搜索或新建标签"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.nativeEvent.isComposing)
                    e.preventDefault();
                }}
              />
              <button
                className="button primary"
                disabled={busy || !name.trim()}
              >
                <Plus size={15} />
                添加
              </button>
            </form>
            <div className="float-existing-tags">
              {presets.tags
                .filter(
                  (t) =>
                    !presets.ids.includes(t.id) &&
                    t.name
                      .toLocaleLowerCase()
                      .includes(name.trim().toLocaleLowerCase()),
                )
                .map((t) => (
                  <button
                    className={`tag-color tone-${tagTone(t.id)}`}
                    key={t.id}
                    disabled={busy}
                    onClick={() => pin(t)}
                  >
                    <TagIcon size={14} />
                    {t.name}
                    <Plus size={13} />
                  </button>
                ))}
            </div>
            {status.error && (
              <p role="alert" className="tag-form-error">
                {status.text}
              </p>
            )}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing.mode === "rename" ? "修改标签" : "删除标签"}
          dismissDisabled={busy}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <div className="modal-content float-editor">
            {editing.mode === "rename" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  changeTag();
                }}
              >
                <input
                  autoFocus
                  aria-label="标签新名称"
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.nativeEvent.isComposing)
                      e.preventDefault();
                  }}
                />
                <button
                  className="button primary"
                  disabled={busy || !name.trim()}
                >
                  <Check size={15} />
                  保存
                </button>
              </form>
            ) : (
              <>
                <p>
                  删除「{editing.tag.name}」及其 {editing.tag.count}{" "}
                  个文件关联？原文件保留。
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={changeTag}
                >
                  删除标签
                </button>
              </>
            )}
            {status.error && (
              <p role="alert" className="tag-form-error">
                {status.text}
              </p>
            )}
          </div>
        </Modal>
      )}
      {exportTag && (
        <ExportTagDialog
          tag={exportTag}
          onClose={() => setExportTag(undefined)}
          onComplete={(result) =>
            notify(
              `已导出「${exportTag.name}」的 ${result.copied} 个文件`,
              false,
              true,
            )
          }
        />
      )}
    </div>
  );
}
