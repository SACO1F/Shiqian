import { TransferDialog } from "./TransferDialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Plus,
  ChevronDown,
  FolderOpen,
  Files,
  Inbox,
  Star,
  Clock3,
  Unplug,
  Settings,
  Tags,
  LayoutGrid,
  List,
  PanelRight,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  X,
  Undo2,
  RefreshCw,
  Trash2,
  LoaderCircle,
  Check,
  ArrowDownUp,
  FolderInput,
  FilePlus2,
  Minus,
  ArrowUpRight,
  PanelsTopLeft,
  Edit3,
} from "lucide-react";
import {
  api,
  message,
  defaultQuery,
  versions,
  kindNames,
  LocalFile,
  Tag,
  Query,
  Results,
  Bootstrap,
  ImportJob,
} from "./api";
import {
  FilesView,
  Inspector,
  Modal,
  TagManager,
  SettingsPanel,
  ImportDetails,
  QuickTagPanel,
} from "./components";
import { Preview, clearPreviews } from "./preview";
import { ExportTagDialog } from "./ExportTagDialog";
import { TagDropFeedback } from "./TagDropFeedback";
import { SidebarResizeHandle, sidebarWidth } from "./SidebarResizeHandle";
import "./workspace-glass.css";
import { useTagArrival } from "./microMotion";
import { NoteDrafts } from "./notes";

const scopes = [
  {
    id: "all",
    name: "全部文件",
    icon: Files,
  },
  {
    id: "inbox",
    name: "待整理",
    icon: Inbox,
  },
  {
    id: "starred",
    name: "我的收藏",
    icon: Star,
  },
  {
    id: "recent",
    name: "最近加入",
    icon: Clock3,
  },
  {
    id: "unavailable",
    name: "需要关注",
    icon: Unplug,
  },
];
type Confirmation = {
  title: string;
  text: string;
  label: string;
  resolve: (ok: boolean) => void;
};
export default function App() {
  const [boot, setBoot] = useState<Bootstrap>();
  const sidebarTagsMotion = useRef<HTMLDivElement>(null);
  useTagArrival(sidebarTagsMotion, boot?.dataPath, boot?.tags ?? []);
  const [fatal, setFatal] = useState("");
  const [query, setQuery] = useState<Query>(defaultQuery);
  const queryRef = useRef(query);
  queryRef.current = query;
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const composing = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const openSearch = useCallback(() => {
    setSearchExpanded(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);
  const [results, setResults] = useState<Results>({
    files: [],
    total: 0,
    offset: 0,
    hasMore: false,
  });
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [selected, setSelected] = useState<string[]>([]);
  const [retainedDetail, setRetainedDetail] = useState<LocalFile>();
  const preserveQuerySelection = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const anchor = useRef("");
  const [loading, setLoading] = useState(false);
  const loadLock = useRef(false);
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [theme, setTheme] = useState("system");
  const [density, setDensity] = useState("comfortable");
  const [views, setViews] = useState<Record<string, string>>({});
  const [details, setDetails] = useState(true);
  const [galleryColumns, setGalleryColumns] = useState(3);
  const [columnCapacity, setColumnCapacity] = useState(8);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSize, setSidebarSize] = useState(216);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  const [addMenu, setAddMenu] = useState(false);
  const [recursive, setRecursive] = useState(true);
  const [filters, setFilters] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [modal, setModal] = useState("");
  const [exportTag, setExportTag] = useState<Tag>();
  const [transferMode, setTransferMode] = useState<"export" | "import">();
  const [transferIds, setTransferIds] = useState<string[]>([]);
  const [editingTag, setEditingTag] = useState<Tag>();
  const [confirm, setConfirm] = useState<Confirmation>();
  const confirmRef = useRef<Confirmation | undefined>(undefined);
  confirmRef.current = confirm;
  const [quick, setQuick] = useState<LocalFile>();
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<ImportJob>();
  const [, redraw] = useState(0);
  const drafts = useRef<NoteDrafts | undefined>(undefined);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const initialized = useRef(false);
  const closeAllowed = useRef(false);
  const recursiveRef = useRef(recursive);
  recursiveRef.current = recursive;
  const currentScope = scopes.find((x) => x.id === query.scope)!;
  const visibleSelected = results.files.filter((f) => selected.includes(f.id));
  const selectedFiles =
    visibleSelected.length === 0 &&
    selected.length === 1 &&
    retainedDetail?.id === selected[0]
      ? [retainedDetail]
      : visibleSelected;
  const single = selectedFiles.length === 1 ? selectedFiles[0] : undefined;
  const view = views[query.scope] || "grid";
  const inspectorVisible =
    details && (view === "list" || selectedFiles.length > 0);
  const tell = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const ask = useCallback(
    (title: string, text: string, label = "确认") =>
      new Promise<boolean>((resolve) =>
        setConfirm({ title, text, label, resolve }),
      ),
    [],
  );
  const answer = (value: boolean) => {
    confirmRef.current?.resolve(value);
    setConfirm(undefined);
  };
  const reload = useCallback(async () => {
    const b = await api<Bootstrap>("bootstrap");
    setBoot(b);
    return b;
  }, []);
  const fetchFiles = useCallback(
    async (q: Query, append = false, preserveLoaded = false) => {
      if (append && loadLock.current) return;
      const token = ++request.current;
      loadLock.current = true;
      setLoading(true);
      try {
        let r = await api<Results>("query", {
          ...q,
          offset: append ? resultsRef.current.files.length : 0,
        });
        if (token !== request.current) return;
        // Background tagging must keep the pages the user has already opened.
        const loaded = preserveLoaded ? resultsRef.current.files.length : 0;
        while (!append && r.hasMore && r.files.length < loaded) {
          const next = await api<Results>("query", {
            ...q,
            offset: r.files.length,
          });
          if (token !== request.current) return;
          if (!next.files.length) break;
          const files = [
            ...r.files,
            ...next.files.filter((f) => !r.files.some((x) => x.id === f.id)),
          ];
          if (files.length === r.files.length) break;
          r = { ...next, offset: 0, files };
        }
        let retained: LocalFile | undefined;
        if (
          preserveLoaded &&
          selectedRef.current.length === 1 &&
          !r.files.some((f) => f.id === selectedRef.current[0])
        ) {
          retained = await api<LocalFile>("file", {
            id: selectedRef.current[0],
          }).catch(() => undefined);
          if (token !== request.current) return;
        }
        if (!append) setRetainedDetail(retained);
        setResults((old) => ({
          ...r,
          files: append
            ? [
                ...old.files,
                ...r.files.filter((f) => !old.files.some((x) => x.id === f.id)),
              ]
            : r.files,
        }));
        if (!append)
          setSelected((old) =>
            old.filter(
              (id) => r.files.some((f) => f.id === id) || retained?.id === id,
            ),
          );
      } catch (e) {
        if (token === request.current) tell(message(e), true);
      } finally {
        if (token === request.current) {
          loadLock.current = false;
          setLoading(false);
        }
      }
    },
    [tell],
  );
  const refresh = useCallback(async () => {
    const b = await reload();
    const q = queryRef.current;
    const include = q.include.filter((id) => b.tags.some((t) => t.id === id));
    const exclude = q.exclude.filter((id) => b.tags.some((t) => t.id === id));
    if (
      include.length !== q.include.length ||
      exclude.length !== q.exclude.length
    ) {
      preserveQuerySelection.current = true;
      setQuery({ ...q, include, exclude });
    } else await fetchFiles(q, false, true);
  }, [reload, fetchFiles]);
  const run = useCallback(
    async (task: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      try {
        await task();
        if (success) tell(success);
      } catch (e) {
        tell(message(e), true);
      } finally {
        setBusy(false);
      }
    },
    [tell],
  );
  const flush = useCallback(async () => {
    clearTimeout(noteTimer.current);
    await drafts.current?.flushAll();
  }, []);
  const startImport = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    setAddMenu(false);
    await api("import", { paths, recursive: recursiveRef.current });
    const j = await api<ImportJob>("import.status");
    setJob(j);
  }, []);

  useEffect(() => {
    let alive = true;
    reload()
      .then((b) => {
        if (!alive) return;
        if (!initialized.current) {
          initialized.current = true;
          setTheme(b.settings.theme || "system");
          setDensity(b.settings.density || "comfortable");
          setViews(b.settings.views || {});
          setDetails(b.settings.details !== false);
          setGalleryColumns(
            Number.isInteger(b.settings.galleryColumns)
              ? Math.max(2, Math.min(8, b.settings.galleryColumns!))
              : 3,
          );
          setSidebarCollapsed(b.settings.sidebarCollapsed === true);
          setSidebarSize(sidebarWidth(b.settings.sidebarWidth));
          drafts.current = new NoteDrafts(b.dataPath);
          drafts.current.onChange = () => redraw((x) => x + 1);
          if (b.notice) tell(b.notice);
        }
        return fetchFiles(queryRef.current);
      })
      .catch((e) => setFatal(message(e)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!composing.current)
        setQuery((q) => (q.text === search ? q : { ...q, text: search }));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const preserve = preserveQuerySelection.current;
    preserveQuerySelection.current = false;
    if (!preserve) {
      setSelected([]);
      setRetainedDetail(undefined);
    }
    void fetchFiles(query, false, preserve);
  }, [query, fetchFiles]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = effective;
      void api("theme.sync", { theme: effective }).catch((error) =>
        tell(message(error), true),
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(undefined),
      toast.error ? 9000 : 4500,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    unlisteners.push(
      listen<ImportJob>("import-progress", (e) => {
        setJob(e.payload);
        if (e.payload.done) {
          void refresh();
          tell(
            e.payload.cancelled
              ? "加入已取消，已完成的内容已保留"
              : `已加入 ${e.payload.added} 个文件${e.payload.failed ? `，${e.payload.failed} 个失败` : ""}`,
          );
        }
      }),
    );
    unlisteners.push(
      listen("library-changed", () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => void refresh().catch((e) => tell(message(e), true)),
          150,
        );
      }),
    );
    const win = getCurrentWebviewWindow();
    unlisteners.push(
      win.onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over")
          setDragging(true);
        else setDragging(false);
        if (e.payload.type === "drop") {
          const paths = e.payload.paths;
          void run(() => startImport(paths));
        }
      }),
    );
    unlisteners.push(
      win.onCloseRequested(async (e) => {
        if (closeAllowed.current) return;
        e.preventDefault();
        try {
          await flush();
          await settingsWrites.current;
          const active = await api<ImportJob | null>("import.status");
          if (active && !active.done) {
            if (
              !(await ask(
                "加入任务尚未完成",
                "关闭后会停止继续加入，已经加入的文件会保留。",
                "停止并退出",
              ))
            )
              return;
            await api("import.cancel");
          }
          closeAllowed.current = true;
          await api("main.close");
          closeAllowed.current = false;
        } catch (error) {
          tell(`备注尚未保存：${message(error)}`, true);
          if (
            await ask(
              "保留草稿并退出？",
              "数据库中的旧备注会保留，新内容已保存在本机草稿中，下次启动时可以继续保存。",
              "保留草稿并退出",
            )
          ) {
            closeAllowed.current = true;
            await api("main.close");
            closeAllowed.current = false;
          }
        }
      }),
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
      for (const p of unlisteners) p.then((fn) => fn());
    };
  }, [refresh, run, startImport, tell, flush, ask]);
  useEffect(() => {
    if (!job || job.done) return;
    const timer = setInterval(
      () =>
        api<ImportJob>("import.status")
          .then((j) => {
            if (j) {
              setJob(j);
              if (j.done) void refresh();
            }
          })
          .catch(() => {}),
      700,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.done, refresh]);

  const mutate = async (action: string, payload: unknown) => {
    await flush();
    await api(action, payload);
    await refresh();
  };
  const updateFiles = async (
    action: string,
    payload: Record<string, unknown>,
  ) =>
    mutate(action, {
      ids: selectedFiles.map((f) => f.id),
      versions: versions(selectedFiles),
      ...payload,
    });
  const addTag = async (tag: Tag, add = true) =>
    updateFiles("files.tags", {
      add: add ? [tag.id] : [],
      remove: add ? [] : [tag.id],
    });
  const createAndTag = async (name: string) => {
    const tag = await api<Tag>("tag.create", { name });
    await addTag(tag);
  };
  const openFile = (f: LocalFile) => run(() => api("files.open", { id: f.id }));
  const undo = () =>
    run(async () => {
      await flush();
      await api("undo");
      await refresh();
    }, "已撤销上一步操作");
  const chooseImport = (directory = false) =>
    run(async () => {
      setAddMenu(false);
      const paths = await open({
        directory,
        multiple: true,
        title: directory ? "选择要加入的文件夹" : "选择要加入的文件",
      });
      if (paths) await startImport(Array.isArray(paths) ? paths : [paths]);
    });
  const chooseDirectory = () =>
    run(async () => {
      const path = await open({
        directory: true,
        multiple: false,
        title: "选择筛选目录",
      });
      if (typeof path === "string")
        setQuery((q) => ({ ...q, directory: path }));
    });
  const relink = () => {
    if (!single) return;
    const file = single;
    void run(async () => {
      const path = await open({
        multiple: false,
        title: `重新关联 ${file.name}`,
      });
      if (typeof path !== "string") return;
      if (
        !(await ask(
          "重新关联文件",
          `当前：${file.path}\n\n关联到：${path}\n\n此文件的标签、备注和收藏会保留。请确认这是同一份资料。`,
          "确认关联",
        ))
      )
        return;
      await mutate("files.relink", {
        id: file.id,
        path,
        version: file.version,
      });
      tell("已重新关联文件");
    });
  };
  const remove = () =>
    run(async () => {
      if (
        !(await ask(
          "从文件库移除",
          `移除所选的 ${selectedFiles.length} 个文件记录。原文件保留在原来的位置，可用“撤销”恢复记录。`,
          "移除记录",
        ))
      )
        return;
      await updateFiles("files.remove", {});
      setSelected([]);
    }, "已从文件库移除，可撤销");
  const setSetting = (key: string, value: unknown) => {
    settingsWrites.current = settingsWrites.current
      .then(async () => {
        await api("settings.save", { key, value });
        setBoot((b) =>
          b ? { ...b, settings: { ...b.settings, [key]: value } } : b,
        );
      })
      .catch((error) => tell(`偏好保存失败：${message(error)}`, true));
  };
  const changeColumns = (columns: number) => {
    setGalleryColumns(columns);
    setSetting("galleryColumns", columns);
  };
  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
    setSetting("sidebarCollapsed", !sidebarCollapsed);
  };
  const visibleColumns = Math.min(galleryColumns, columnCapacity);
  const backup = () =>
    run(async () => {
      await flush();
      const path = await save({
        title: "导出标注备份",
        defaultPath: `拾签标注-${new Date().toLocaleDateString("sv-SE")}.sqtagbackup`,
        filters: [{ name: "拾签标注备份", extensions: ["sqtagbackup"] }],
      });
      if (path) {
        await api("backup.export", { path });
        tell("标注备份已导出");
      }
    });
  const restore = () =>
    run(async () => {
      const path = await open({
        title: "选择标注备份",
        multiple: false,
        filters: [{ name: "拾签标注备份", extensions: ["sqtagbackup"] }],
      });
      if (typeof path !== "string") return;
      const info = await api<{
        fileCount: number;
        tagCount: number;
        createdAt: number;
      }>("backup.inspect", { path });
      if (
        !(await ask(
          "用备份恢复文件库",
          `已验证备份完整性：${info.fileCount} 个文件记录，${info.tagCount} 个标签。\n\n恢复将替换当前标注库，并自动备份当前内容。原文件需仍在记录的位置。`,
          "备份当前库并恢复",
        ))
      )
        return;
      await flush();
      const restored = await api<{ recoveryBackup: string }>("backup.restore", {
        path,
      });
      drafts.current?.clear();
      clearPreviews();
      setSelected([]);
      setSearch("");
      setQuery(defaultQuery());
      const b = await reload();
      setViews(b.settings.views || {});
      setTheme(b.settings.theme || "system");
      setDensity(b.settings.density || "comfortable");
      setDetails(b.settings.details !== false);
      setGalleryColumns(
        Number.isInteger(b.settings.galleryColumns)
          ? Math.max(2, Math.min(8, b.settings.galleryColumns!))
          : 3,
      );
      setSidebarCollapsed(b.settings.sidebarCollapsed === true);
      setSidebarSize(sidebarWidth(b.settings.sidebarWidth));
      await fetchFiles(defaultQuery());
      tell(`恢复完成。恢复前的标注已保存在 ${restored.recoveryBackup}`);
      await api("refresh");
    });
  const select = (f: LocalFile, e: React.MouseEvent) => {
    void flush().catch((error) => tell(message(error), true));
    setSelected((old) => {
      if (e.shiftKey && anchor.current) {
        const a = results.files.findIndex((x) => x.id === anchor.current),
          b = results.files.findIndex((x) => x.id === f.id);
        if (a >= 0)
          return [
            ...new Set([
              ...(e.ctrlKey ? old : []),
              ...results.files
                .slice(Math.min(a, b), Math.max(a, b) + 1)
                .map((x) => x.id),
            ]),
          ];
      }
      anchor.current = f.id;
      return e.ctrlKey || e.metaKey
        ? old.includes(f.id)
          ? old.filter((x) => x !== f.id)
          : [...old, f.id]
        : [f.id];
    });
  };
  const tagFilter = (id: string, exclude = false) =>
    setQuery((q) => {
      const field = exclude ? "exclude" : "include",
        other = exclude ? "include" : "exclude";
      return {
        ...q,
        [field]: q[field].includes(id)
          ? q[field].filter((x) => x !== id)
          : [...q[field], id],
        [other]: q[other].filter((x) => x !== id),
      };
    });
  const resetFilters = () => {
    setSearch("");
    setQuery((q) => ({ ...defaultQuery(), scope: q.scope }));
  };
  const selectSidebarTag = (id: string) =>
    setQuery((q) => ({
      ...q,
      include: q.include.length === 1 && q.include[0] === id ? [] : [id],
      exclude: [],
    }));
  const filterCount =
    query.include.length +
    query.exclude.length +
    query.kinds.length +
    Number(!!query.status) +
    Number(!!query.directory) +
    Number(!!query.from || !!query.to);
  const reloadNote = () =>
    run(async () => {
      if (!single) return;
      if (
        !(await ask(
          "重新读取备注",
          "这会用数据库中的已保存内容替换当前草稿。",
          "重新读取",
        ))
      )
        return;
      const f = await api<LocalFile>("file", { id: single.id });
      drafts.current?.discard(f);
      setResults((r) => ({
        ...r,
        files: r.files.map((x) => (x.id === f.id ? f : x)),
      }));
    });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = !!target.closest(
        'input,textarea,[contenteditable="true"],select',
      );
      if (quick && e.key === " " && !typing) {
        e.preventDefault();
        setQuick(undefined);
        return;
      }
      if (
        e.isComposing ||
        confirm ||
        modal ||
        quick ||
        exportTag ||
        transferMode
      )
        return;
      const inFiles = !!target.closest(".file-area");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (boot?.undoLabel && !busy) undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && inFiles) {
        e.preventDefault();
        setSelected(results.files.slice(0, 1000).map((f) => f.id));
        if (results.files.length > 1000)
          tell("批量操作每次最多选择 1,000 个文件");
      }
      if (e.key === "Escape") {
        setSelected([]);
        setAddMenu(false);
        setFilters(false);
      }
      if (e.key === " " && single && inFiles) {
        e.preventDefault();
        setQuick(single);
      }
      if (e.key === "Enter" && single && inFiles) {
        e.preventDefault();
        openFile(single);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    boot,
    busy,
    results,
    single,
    confirm,
    modal,
    quick,
    exportTag,
    transferMode,
  ]);

  if (fatal)
    return (
      <div className="startup">
        <img src="/icon.svg" alt="拾签" />
        <h1>资料库暂时无法打开</h1>
        <p>{fatal}</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新尝试
        </button>
      </div>
    );
  if (!boot)
    return (
      <div className="startup">
        <img src="/icon.svg" alt="拾签" />
        <LoaderCircle className="spin" />
        <p>正在打开你的文件工作台…</p>
      </div>
    );
  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""} ${sidebarResizing ? "sidebar-is-resizing" : ""} ${view === "grid" ? "gallery-mode" : ""}`}
      style={{ "--sidebar-width": `${sidebarSize}px` } as CSSProperties}
      data-busy={busy}
    >
      <TagDropFeedback tags={boot.tags} run={run} onNotify={tell} />
      <aside className="sidebar" id="workspace-sidebar" aria-label="工作台导航">
        <SidebarResizeHandle
          width={sidebarSize}
          collapsed={sidebarCollapsed}
          onResizing={setSidebarResizing}
          onChange={({ width, collapsed }) => {
            setSidebarSize(width);
            setSidebarCollapsed(collapsed);
          }}
          onCommit={({ width, collapsed }) => {
            setSetting("sidebarWidth", width);
            setSetting("sidebarCollapsed", collapsed);
          }}
        />
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <div>
            <strong>拾签</strong>
          </div>
        </div>
        <nav className="main-nav">
          {scopes.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                aria-label={s.name}
                title={sidebarCollapsed ? s.name : undefined}
                className={query.scope === s.id ? "active" : ""}
                onClick={() => {
                  void flush().catch((e) => tell(message(e), true));
                  setSearch("");
                  setQuery({ ...defaultQuery(), scope: s.id });
                }}
              >
                <Icon size={18} />
                <span>{s.name}</span>
                <small>{boot.counts[s.id] || 0}</small>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-index">
          <button
            className="sidebar-tags-expand icon-button"
            inert={!sidebarCollapsed}
            aria-hidden={!sidebarCollapsed}
            aria-label="展开标签索引"
            title="展开标签索引"
            onClick={toggleSidebar}
          >
            <Tags size={18} />
          </button>
          <div
            className="sidebar-index-content"
            inert={sidebarCollapsed}
            aria-hidden={sidebarCollapsed}
          >
            <div className="sidebar-section">
              <span>标签索引</span>
              <button
                className="icon-button"
                aria-label="管理标签"
                title="管理标签"
                onClick={() => {
                  setEditingTag(undefined);
                  setModal("tags");
                }}
              >
                <Settings size={15} />
              </button>
            </div>
            <div className="sidebar-tags" ref={sidebarTagsMotion}>
              {boot.tags.length ? (
                [
                  { name: "文件夹", label: "文件夹标签", folder: true },
                  { name: "标签", label: "普通标签", folder: false },
                ].map((group) => {
                  const tags = boot.tags.filter(
                    (t) => (t.createdBy === "folder") === group.folder,
                  );
                  return (
                    tags.length > 0 && (
                      <section
                        className="sidebar-tag-group"
                        key={group.label}
                        aria-label={group.label}
                      >
                        <div className="sidebar-tag-group-title">
                          <span>{group.name}</span>
                          <small>{tags.length}</small>
                        </div>
                        {tags.map((t) => (
                          <div
                            className="sidebar-tag-row"
                            key={t.id}
                            data-motion-tag={t.id}
                          >
                            <button
                              className={`sidebar-tag-filter ${query.include.includes(t.id) ? "active" : ""}`}
                              onClick={() => selectSidebarTag(t.id)}
                              aria-pressed={query.include.includes(t.id)}
                              title={t.name}
                            >
                              {group.folder ? (
                                <FolderOpen size={13} />
                              ) : (
                                <span className="tag-dot" />
                              )}
                              <span>{t.name}</span>
                              <small>{t.count}</small>
                            </button>
                            <button
                              className="icon-button sidebar-tag-edit"
                              aria-label={`编辑标签${t.name}`}
                              title="重命名标签"
                              onClick={() => {
                                setEditingTag(t);
                                setModal("tags");
                              }}
                            >
                              <Edit3 size={13} />
                            </button>
                          </div>
                        ))}
                      </section>
                    )
                  );
                })
              ) : (
                <p>暂无标签</p>
              )}
            </div>
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className="floating-launch"
            aria-label="标签浮窗"
            title={sidebarCollapsed ? "标签浮窗" : undefined}
            onClick={() => void run(() => api("floating.open"))}
          >
            <PanelsTopLeft size={17} />
            <span>标签浮窗</span>
          </button>
          <button
            onClick={() => setModal("settings")}
            aria-label="偏好设置"
            title={sidebarCollapsed ? "偏好设置" : undefined}
          >
            <Settings size={17} />
            <span>偏好设置</span>
            <small>v{boot.version}</small>
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "展开左侧菜单" : "收拢左侧菜单"}
            title={sidebarCollapsed ? "展开左侧菜单" : "收拢左侧菜单"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="workspace-sidebar"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
          <div className="breadcrumb">工作台</div>
          <div className="top-actions">
            <button
              className="icon-button"
              title={
                boot.undoLabel
                  ? `撤销：${boot.undoLabel} (Ctrl+Z)`
                  : "没有可撤销的操作"
              }
              aria-label="撤销上一步"
              disabled={!boot.undoLabel || busy}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="刷新文件状态"
              title="重新检查原文件状态"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  clearPreviews();
                  await api("refresh");
                }, "正在检查文件位置与状态")
              }
            >
              <RefreshCw size={16} />
            </button>
            <div className="top-divider" />
            <span className="local-badge">
              <span /> 本地资料库
            </span>
          </div>
        </header>
        <section className="page-heading">
          <div className="page-title-group">
            <h1>
              {currentScope.name}
              <span>{results.total}</span>
            </h1>
            <div
              className={`heading-search ${searchExpanded ? "is-open" : ""}`}
            >
              <button
                ref={searchButton}
                className={`icon-button search-toggle ${search ? "has-query" : ""}`}
                aria-label={searchExpanded ? "收起搜索栏" : "展开搜索栏"}
                title={searchExpanded ? "收起搜索栏" : "搜索文件 · Ctrl F"}
                aria-expanded={searchExpanded}
                aria-controls="workspace-search"
                onClick={() =>
                  searchExpanded ? setSearchExpanded(false) : openSearch()
                }
              >
                <Search size={19} />
              </button>
              <div
                id="workspace-search"
                className="search-reveal"
                inert={!searchExpanded}
                aria-hidden={!searchExpanded}
              >
                <div className="search-box">
                  <input
                    ref={searchRef}
                    aria-label="搜索文件"
                    value={search}
                    onCompositionStart={() => {
                      composing.current = true;
                    }}
                    onCompositionEnd={(e) => {
                      composing.current = false;
                      const text = e.currentTarget.value;
                      setSearch(text);
                      setQuery((q) => ({ ...q, text }));
                    }}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        e.stopPropagation();
                        setSearchExpanded(false);
                        searchButton.current?.focus();
                      }
                    }}
                    placeholder="搜索名称、标签或备注…"
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="清空搜索"
                      onClick={() => {
                        setSearch("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="add-wrapper">
            <button
              className="button primary add-button"
              onClick={() => setAddMenu((x) => !x)}
              disabled={busy || (!!job && !job.done)}
            >
              <Plus size={17} />
              加入文件
              <ChevronDown size={14} />
            </button>
            {addMenu && (
              <>
                <div
                  className="menu-dismiss"
                  onClick={() => setAddMenu(false)}
                />
                <div className="add-menu">
                  <button onClick={() => chooseImport()}>
                    <FilePlus2 size={16} />
                    选择文件
                  </button>
                  <button onClick={() => chooseImport(true)}>
                    <FolderInput size={16} />
                    选择文件夹
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={recursive}
                      onChange={(e) => setRecursive(e.target.checked)}
                    />
                    包含子文件夹
                  </label>
                </div>
              </>
            )}
          </div>
        </section>
        <section className="toolbar">
          <button
            className={`button filter-button ${filters || filterCount ? "engaged" : ""}`}
            aria-expanded={filters}
            aria-controls="workspace-filters"
            onClick={() => setFilters((v) => !v)}
          >
            <SlidersHorizontal size={15} />
            筛选{filterCount > 0 && <span>{filterCount}</span>}
          </button>
          <div
            className="view-controls"
            data-view={view}
            role="group"
            aria-label="文件布局"
          >
            <button
              className="icon-button"
              aria-label="瀑布流视图"
              title="瀑布流视图"
              aria-pressed={view === "grid"}
              onClick={() => {
                const v = { ...views, [query.scope]: "grid" };
                setViews(v);
                setSetting("views", v);
              }}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="列表视图"
              aria-pressed={view === "list"}
              onClick={() => {
                const v = { ...views, [query.scope]: "list" };
                setViews(v);
                setSetting("views", v);
              }}
            >
              <List size={18} />
            </button>
          </div>
          <button
            className="icon-button detail-toggle"
            aria-label="切换详情面板"
            aria-pressed={details}
            aria-expanded={inspectorVisible}
            aria-controls="workspace-inspector"
            onClick={() => {
              setDetails(!details);
              setSetting("details", !details);
            }}
          >
            <PanelRight size={17} />
          </button>
        </section>
        <div
          className={`filter-reveal ${filters ? "is-open" : ""}`}
          id="workspace-filters"
          inert={!filters}
          aria-hidden={!filters}
        >
          <div className="filter-clip">
            <section className="filter-panel" aria-label="文件筛选">
              <div className="filter-line">
                <strong>文件类型</strong>
                <div className="filter-choices">
                  {Object.entries(kindNames).map(([id, name]) => (
                    <button
                      key={id}
                      aria-pressed={query.kinds.includes(id)}
                      onClick={() =>
                        setQuery((q) => ({
                          ...q,
                          kinds: q.kinds.includes(id)
                            ? q.kinds.filter((x) => x !== id)
                            : [...q.kinds, id],
                        }))
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="文件状态筛选"
                  value={query.status}
                  onChange={(e) =>
                    setQuery((q) => ({ ...q, status: e.target.value }))
                  }
                >
                  <option value="">全部状态</option>
                  <option value="available">可用</option>
                  <option value="missing">文件缺失</option>
                  <option value="offline">存储离线</option>
                  <option value="inaccessible">访问异常</option>
                </select>
              </div>
              <div className="filter-line">
                <strong>标签条件</strong>
                <select
                  aria-label="标签匹配方式"
                  value={query.mode}
                  onChange={(e) =>
                    setQuery((q) => ({ ...q, mode: e.target.value }))
                  }
                >
                  <option value="all">满足全部标签</option>
                  <option value="any">满足任一标签</option>
                </select>
                <input
                  className="filter-tag-search"
                  aria-label="查找筛选标签"
                  placeholder="查找标签"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                />
                <small>点击名称包含，点击 − 排除</small>
              </div>
              <div className="filter-tag-list">
                {boot.tags
                  .filter((t) => t.name.includes(tagSearch))
                  .map((t) => (
                    <span
                      key={t.id}
                      className={`filter-tag ${query.include.includes(t.id) ? "included" : ""} ${query.exclude.includes(t.id) ? "excluded" : ""}`}
                    >
                      <button onClick={() => tagFilter(t.id)}>
                        {query.include.includes(t.id) && <Check size={12} />}{" "}
                        {t.name}
                      </button>
                      <button
                        aria-label={`排除${t.name}`}
                        onClick={() => tagFilter(t.id, true)}
                      >
                        <Minus size={12} />
                      </button>
                    </span>
                  ))}
              </div>
              <div className="filter-line">
                <strong>修改时间</strong>
                <input
                  type="date"
                  aria-label="修改起始日期"
                  value={
                    query.from
                      ? new Date(query.from).toLocaleDateString("sv-SE")
                      : ""
                  }
                  onChange={(e) =>
                    setQuery((q) => ({
                      ...q,
                      from: e.target.value
                        ? new Date(`${e.target.value}T00:00:00`).getTime()
                        : undefined,
                    }))
                  }
                />
                <span>至</span>
                <input
                  type="date"
                  aria-label="修改结束日期"
                  value={
                    query.to
                      ? new Date(query.to - 1).toLocaleDateString("sv-SE")
                      : ""
                  }
                  onChange={(e) =>
                    setQuery((q) => ({
                      ...q,
                      to: e.target.value
                        ? new Date(`${e.target.value}T00:00:00`).getTime() +
                          86400000
                        : undefined,
                    }))
                  }
                />
                <button
                  className="button quiet directory-filter"
                  onClick={chooseDirectory}
                  title={query.directory}
                >
                  <FolderOpen size={14} />
                  {query.directory
                    ? query.directory.split(/[\\/]/).at(-1)
                    : "限定文件夹"}
                </button>
                {query.directory && (
                  <>
                    <button
                      className="icon-button"
                      aria-label="清除目录筛选"
                      onClick={() => setQuery((q) => ({ ...q, directory: "" }))}
                    >
                      <X size={13} />
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={query.recursive}
                        onChange={(e) =>
                          setQuery((q) => ({
                            ...q,
                            recursive: e.target.checked,
                          }))
                        }
                      />
                      包含子目录
                    </label>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
        {(filterCount > 0 || query.text) && (
          <div className="active-filters">
            <span>正在筛选</span>
            {query.include.map((id) => (
              <button key={id} onClick={() => tagFilter(id)}>
                # {boot.tags.find((t) => t.id === id)?.name || "已删除标签"}
                <X size={11} />
              </button>
            ))}
            {query.exclude.map((id) => (
              <button
                key={id}
                className="negative"
                onClick={() => tagFilter(id, true)}
              >
                排除 {boot.tags.find((t) => t.id === id)?.name}
                <X size={11} />
              </button>
            ))}
            <button className="reset-filters" onClick={resetFilters}>
              清除条件
            </button>
          </div>
        )}
        <div className="content-meta">
          <div>
            {loading ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <span className="tiny-dot" />
            )}
            {selected.length
              ? `已选 ${selected.length} 项`
              : `${results.total} 份文件`}
            {selected.length > 0 && (
              <button onClick={() => setSelected([])}>取消选择</button>
            )}
          </div>
          {view === "grid" && (
            <div
              className="gallery-controls"
              role="group"
              aria-label="图片列数"
            >
              <button
                className="icon-button"
                aria-label="减少列数"
                title="减少一列"
                disabled={visibleColumns <= 2}
                onClick={() => changeColumns(visibleColumns - 1)}
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                aria-label="瀑布流列数"
                aria-valuetext={`${visibleColumns} 列`}
                min={2}
                max={columnCapacity}
                step={1}
                value={visibleColumns}
                onChange={(event) => changeColumns(Number(event.target.value))}
              />
              <button
                className="icon-button"
                aria-label="增加列数"
                title="增加一列"
                disabled={visibleColumns >= columnCapacity}
                onClick={() => changeColumns(visibleColumns + 1)}
              >
                <Plus size={14} />
              </button>
              <output aria-live="polite">{visibleColumns} 列</output>
            </div>
          )}
          {selected.length > 0 ? (
            <div className="selection-actions">
              <button
                disabled={busy}
                onClick={() =>
                  run(() =>
                    updateFiles("files.favorite", {
                      value: !selectedFiles.every((f) => f.favorite),
                    }),
                  )
                }
              >
                <Star size={14} />
                {selectedFiles.every((f) => f.favorite) ? "取消收藏" : "收藏"}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await flush();
                    setTransferIds(selectedFiles.map((f) => f.id));
                    setTransferMode("export");
                  });
                }}
              >
                导出资料包
              </button>
              <button disabled={busy} onClick={remove}>
                <Trash2 size={14} />
                移除
              </button>
            </div>
          ) : (
            <div className="sort-control">
              <ArrowDownUp size={13} />
              <select
                aria-label="文件排序"
                value={query.sort}
                onChange={(e) =>
                  setQuery((q) => ({ ...q, sort: e.target.value }))
                }
              >
                <option value="added">加入时间</option>
                <option value="modified">修改时间</option>
                <option value="name">名称</option>
                <option value="size">文件大小</option>
              </select>
              <button
                aria-label="切换排序方向"
                onClick={() =>
                  setQuery((q) => ({
                    ...q,
                    direction: q.direction === "asc" ? "desc" : "asc",
                  }))
                }
              >
                {query.direction === "asc" ? "升序" : "降序"}
              </button>
            </div>
          )}
        </div>
        <div className="content-body">
          <FilesView
            key={JSON.stringify(query)}
            files={results.files}
            total={results.total}
            view={view}
            density={density}
            galleryColumns={galleryColumns}
            onColumnCapacity={setColumnCapacity}
            selected={selected}
            onSelect={select}
            onOpen={openFile}
            onMore={() => fetchFiles(query, true)}
            hasMore={results.hasMore}
            loading={loading}
            onAdd={() => chooseImport()}
            filtered={!!filterCount || !!query.text || query.scope !== "all"}
            onReset={resetFilters}
          />
          <div
            id="workspace-inspector"
            className={`inspector-reveal ${inspectorVisible ? "is-open" : ""}`}
            inert={!inspectorVisible}
            aria-hidden={!inspectorVisible}
          >
            <Inspector
              files={selectedFiles}
              tags={boot.tags}
              draft={single ? drafts.current?.get(single) : undefined}
              onNote={(text) => {
                if (!single) return;
                drafts.current?.edit(single, text);
                clearTimeout(noteTimer.current);
                noteTimer.current = setTimeout(
                  () =>
                    void drafts.current
                      ?.flush(single.id)
                      .catch((e) => tell(message(e), true)),
                  500,
                );
              }}
              onFlush={() => void flush().catch((e) => tell(message(e), true))}
              onReloadNote={reloadNote}
              onTag={(t, add) => run(() => addTag(t, add))}
              onCreateTag={(name) => run(() => createAndTag(name))}
              onOpen={() => single && openFile(single)}
              onReveal={() =>
                single && run(() => api("files.reveal", { id: single.id }))
              }
              onCopy={() =>
                single &&
                run(
                  () => navigator.clipboard.writeText(single.path),
                  "路径已复制",
                )
              }
              onRelink={relink}
              onPreview={() => single && setQuick(single)}
              onAnalyze={() =>
                run(async () => {
                  await api("ai.enqueue", {
                    ids: selectedFiles.map((f) => f.id),
                  });
                  await refresh();
                }, "已加入 AI 识别队列")
              }
              onCancelAI={() =>
                run(async () => {
                  await api("ai.cancel", {
                    ids: selectedFiles.map((f) => f.id),
                  });
                  await refresh();
                }, "已取消所选文件的 AI 任务")
              }
              onConfirmAI={(tag) =>
                single &&
                run(async () => {
                  await api("ai.confirm", {
                    id: single.id,
                    tagId: tag.id,
                    version: single.version,
                  });
                  await refresh();
                }, "标签已接受并加入浮窗")
              }
              onConfigureAI={() => setModal("settings")}
              busy={busy}
            />
          </div>
        </div>
        <footer className="statusbar">
          <span>
            {job && !job.done ? (
              <>
                <LoaderCircle size={13} className="spin" />
                正在加入 · 已处理 {job.processed} 个
                <button onClick={() => run(() => api("import.cancel"))}>
                  取消
                </button>
              </>
            ) : job ? (
              <>
                <Check size={13} />
                {job.cancelled ? "已停止加入" : "加入完成"} · 新增 {job.added}{" "}
                个<button onClick={() => setModal("import")}>查看详情</button>
              </>
            ) : (
              <>{boot.settings.ai?.enabled ? "AI 自动标注已开启" : ""}</>
            )}
          </span>
          <span>
            Ctrl 多选<span className="separator">·</span>Space 预览
            <span className="separator">·</span>Ctrl Z 撤销
          </span>
        </footer>
      </main>
      <button
        className="tag-fab"
        aria-label="添加标签悬浮按钮"
        title={
          selectedFiles.length
            ? `为 ${selectedFiles.length} 个文件添加标签`
            : "新建标签"
        }
        onClick={() => setModal("quick-tag")}
        disabled={busy}
      >
        <Plus size={21} />
        <span>添加标签</span>
        {selectedFiles.length > 0 && <small>{selectedFiles.length}</small>}
      </button>
      {modal === "quick-tag" && (
        <Modal title="添加标签" onClose={() => setModal("")}>
          <QuickTagPanel
            tags={boot.tags}
            count={selectedFiles.length}
            onApply={async (name) => {
              if (selectedFiles.length) await createAndTag(name);
              else {
                await api("tag.create", { name });
                await refresh();
              }
              tell(selectedFiles.length ? "标签已添加" : "标签已创建");
              setModal("");
            }}
            onManage={() => {
              setEditingTag(undefined);
              setModal("tags");
            }}
          />
        </Modal>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <FolderInput size={48} />
            <h2>松手，加入文件库</h2>
            <p>原文件不移动，标注留在拾签</p>
          </div>
        </div>
      )}
      {modal === "tags" && (
        <Modal title="管理标签" onClose={() => setModal("")}>
          <TagManager
            tags={boot.tags}
            initialTag={editingTag}
            onExport={(tag) => {
              setModal("");
              setExportTag(tag);
            }}
            busy={busy}
            onCreate={async (name) => {
              await api("tag.create", { name });
              await reload();
            }}
            onRename={async (t, name) => {
              await mutate("tags.rename", {
                id: t.id,
                name,
                version: t.version,
              });
              tell("标签已重命名，关联文件已同步");
            }}
            onDelete={(t) =>
              run(async () => {
                if (
                  await ask(
                    "删除标签",
                    `“${t.name}”关联了 ${t.count} 个文件。删除会移除这些关联，文件记录和备注会保留。`,
                    "删除标签",
                  )
                ) {
                  await mutate("tags.delete", { id: t.id, version: t.version });
                }
              })
            }
          />
        </Modal>
      )}
      {exportTag && (
        <ExportTagDialog
          tag={exportTag}
          onClose={() => setExportTag(undefined)}
        />
      )}
      {transferMode && (
        <TransferDialog
          mode={transferMode}
          ids={transferIds}
          tags={boot.tags}
          onClose={() => setTransferMode(undefined)}
          onImported={() => {
            void refresh().catch((e) => tell(message(e), true));
          }}
        />
      )}
      {modal === "settings" && (
        <Modal title="偏好设置" onClose={() => setModal("")}>
          <SettingsPanel
            boot={boot}
            theme={theme}
            setTheme={(s) => {
              setTheme(s);
              setSetting("theme", s);
            }}
            density={density}
            setDensity={(s) => {
              setDensity(s);
              setSetting("density", s);
            }}
            onPackageExport={() => {
              void run(async () => {
                await flush();
                setModal("");
                setTransferIds([]);
                setTransferMode("export");
              });
            }}
            onPackageImport={() => {
              setModal("");
              setTransferIds([]);
              setTransferMode("import");
            }}
            onBackup={backup}
            onRestore={restore}
            onClear={() =>
              run(async () => {
                await api("cache.clear");
                clearPreviews();
                redraw((x) => x + 1);
              }, "预览缓存已清理")
            }
            onData={() => run(() => api("data.reveal"))}
            busy={busy}
          />
        </Modal>
      )}
      {modal === "import" && job && (
        <Modal title="文件加入详情" onClose={() => setModal("")}>
          <ImportDetails job={job} />
        </Modal>
      )}
      {quick && (
        <Modal title={quick.name} onClose={() => setQuick(undefined)} wide>
          <div className="quick-preview">
            <Preview file={quick} large />
          </div>
          <div className="quick-footer">
            <span>{quick.kind === "pdf" ? "PDF 首页预览" : quick.path}</span>
            <button className="button primary" onClick={() => openFile(quick)}>
              <ArrowUpRight size={15} />
              打开原文件
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => answer(false)}>
          <div className="modal-content">
            <p className="confirm-text">{confirm.text}</p>
            <div className="confirm-actions">
              <button className="button" onClick={() => answer(false)}>
                取消
              </button>
              <button className="button primary" onClick={() => answer(true)}>
                {confirm.label}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="关闭通知"
            onClick={() => setToast(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
