import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  Star,
  FileText,
  ImageIcon,
  FolderOpen,
  ArrowUpRight,
  Copy,
  Link2,
  Plus,
  Check,
  Minus,
  LoaderCircle,
  AlertCircle,
  CheckCheck,
  Tags,
  Trash2,
  Edit3,
  Download,
  Upload,
  Sun,
  Moon,
  Monitor,
  HardDrive,
  RefreshCw,
  Maximize2,
  Sparkles,
} from "lucide-react";
import {
  LocalFile,
  Tag,
  Query,
  ImportJob,
  Bootstrap,
  size,
  date,
  statusNames,
  kindNames,
  message,
} from "./api";
import { Preview } from "./preview";
import { Draft } from "./notes";
import { MasonryGallery } from "./MasonryGallery";
import { TagSource } from "./TagSource";
import { FileTagsHover } from "./FileTagsHover";
import { AutoTagSettings } from "./AutoTagSettings";
import { SelectionCheck, reducedMotion, useTagArrival } from "./microMotion";
import { AiTaskStatus } from "./TaskStatus";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  dismissDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  dismissDisabled?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  function dismiss() {
    if (dismissDisabled || closeTimer.current) return;
    if (reducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setClosing(false);
      closeAction.current();
    }, 140);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previous = previousFocus.current;
    const el = ref.current;
    if (!el?.contains(document.activeElement))
      el?.querySelector<HTMLElement>("[autofocus],input,button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className={`modal-backdrop ${closing ? "is-closing" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        inert={closing}
        aria-hidden={closing || undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            dismiss();
          }
          if (e.key === "Tab") {
            const items = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input,textarea,select,[tabindex="0"]',
              ) ?? []),
            ].filter((n) => n.offsetParent !== null);
            if (items.length) {
              if (e.shiftKey && document.activeElement === items[0]) {
                e.preventDefault();
                items.at(-1)?.focus();
              } else if (
                !e.shiftKey &&
                document.activeElement === items.at(-1)
              ) {
                e.preventDefault();
                items[0].focus();
              }
            }
          }
        }}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={dismiss}
            disabled={dismissDisabled}
            aria-label="关闭对话框"
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function FilesView({
  files,
  total,
  view,
  density,
  galleryColumns,
  onColumnCapacity,
  selected,
  onSelect,
  onOpen,
  onMore,
  hasMore,
  loading,
  onAdd,
  filtered,
  onReset,
}: {
  files: LocalFile[];
  total: number;
  view: string;
  density: string;
  galleryColumns: number;
  onColumnCapacity: (capacity: number) => void;
  selected: string[];
  onSelect: (f: LocalFile, e: React.MouseEvent) => void;
  onOpen: (f: LocalFile) => void;
  onMore: () => void;
  hasMore: boolean;
  loading: boolean;
  onAdd: () => void;
  filtered: boolean;
  onReset: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  const offsets = useRef<Record<string, number>>({});
  const measurements = useRef(
    new Map<string, { width: number; height: number }>(),
  );
  const [width, setWidth] = useState(700);
  useLayoutEffect(() => {
    if (!scroll.current) return;
    const element = scroll.current;
    const style = getComputedStyle(element);
    setWidth(
      element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    );
    element.scrollTop = offsets.current[view] ?? 0;
    const obs = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    obs.observe(element);
    return () => obs.disconnect();
  }, [view]);
  const capacity = Math.max(2, Math.min(8, Math.floor((width + 14) / 134)));
  useEffect(() => onColumnCapacity(capacity), [capacity, onColumnCapacity]);
  const rowHeight = density === "compact" ? 58 : 68;
  const virtual = useVirtualizer({
    count: files.length,
    getScrollElement: () => scroll.current,
    enabled: view === "list",
    initialOffset: () => offsets.current.list ?? 0,
    getItemKey: (index) => files[index].id,
    estimateSize: () => rowHeight,
    overscan: 2,
  });
  useLayoutEffect(() => {
    virtual.measure();
  }, [rowHeight]);
  useLayoutEffect(() => {
    const changed = previousView.current !== view;
    previousView.current = view;
    if (!changed || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    // Animate the content after its geometry is committed, keeping the scroller
    // and both layouts' remembered offsets outside the moving layer.
    const motion = layout.current?.animate(
      [
        {
          transform: `translateX(${view === "list" ? 16 : -16}px)`,
          opacity: 0.72,
        },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => motion?.cancel();
  }, [view]);
  return (
    <div
      key={view}
      className="file-area"
      ref={scroll}
      role="listbox"
      aria-label="文件结果"
      aria-multiselectable="true"
      tabIndex={0}
      onScroll={() => {
        const el = scroll.current;
        if (el) offsets.current[view] = el.scrollTop;
        if (
          el &&
          hasMore &&
          !loading &&
          el.scrollHeight - el.scrollTop - el.clientHeight < 400
        )
          onMore();
      }}
    >
      <div ref={layout} className="files-layout-motion" data-layout={view}>
        {files.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">
              <div className="paper-one">
                <ImageIcon size={34} strokeWidth={1.4} />
              </div>
              <div className="paper-two">
                <FileText size={34} strokeWidth={1.4} />
              </div>
              <span className="floating-tag">
                <Tags size={14} /> 有迹可寻
              </span>
            </div>
            <h2>
              {filtered ? "这里还没有符合条件的文件" : "给文件一个被找到的理由"}
            </h2>
            <p>
              {filtered ? (
                "试试其他关键词，或调整筛选条件。"
              ) : (
                <>
                  把图片、文档和灵感留在原来的位置，
                  <br />
                  用标签串起它们的用途。
                </>
              )}
            </p>
            <button
              className="button primary"
              onClick={filtered ? onReset : onAdd}
            >
              {filtered ? <X size={16} /> : <Plus size={16} />}{" "}
              {filtered ? "清除筛选条件" : "加入第一份文件"}
            </button>
            <span className="subtle">也可以将文件或文件夹拖入窗口</span>
          </div>
        ) : (
          <>
            {view === "list" && (
              <div className="file-list-heading">
                <span>文件名称</span>
                <span>标签</span>
                <span>修改时间</span>
                <span>大小</span>
              </div>
            )}
            {view === "grid" ? (
              <MasonryGallery
                files={files}
                scroll={scroll}
                width={width}
                columns={Math.min(galleryColumns, capacity)}
                gap={density === "compact" ? 10 : 18}
                selected={selected}
                onSelect={onSelect}
                onOpen={onOpen}
                initialOffset={offsets.current.grid ?? 0}
                measurements={measurements}
              />
            ) : (
              <div
                className="virtual-space"
                style={{ height: virtual.getTotalSize() }}
              >
                {virtual.getVirtualItems().map((row) => {
                  const f = files[row.index];
                  return (
                    <div
                      className="virtual-row list-row"
                      key={f.id}
                      style={{
                        transform: `translateY(${row.start}px)`,
                        height: rowHeight,
                      }}
                    >
                      <FileTagsHover file={f}>
                        {(hoverHandlers) => (
                          <button
                            {...hoverHandlers}
                            data-file-id={f.id}
                            className={`file-card file-list ${selected.includes(f.id) ? "is-selected" : ""} ${f.status !== "available" ? "is-unavailable" : ""}`}
                            role="option"
                            aria-selected={selected.includes(f.id)}
                            aria-label={f.name}
                            onClick={(event) => onSelect(f, event)}
                            onDoubleClick={() => onOpen(f)}
                          >
                            <span className="file-art">
                              <Preview file={f} compact />
                              <SelectionCheck
                                checked={selected.includes(f.id)}
                                small
                              />
                            </span>
                            <span className="file-description">
                              <span className="file-name" title={f.name}>
                                {f.name}
                                {f.favorite && (
                                  <Star size={12} fill="currentColor" />
                                )}
                              </span>
                              <span className="file-subline" title={f.path}>
                                {f.status !== "available"
                                  ? statusNames[f.status]
                                  : f.parent}
                              </span>
                            </span>
                            <span className="list-tags">
                              {f.tags.slice(0, 2).map((t) => (
                                <span className="tag-pill" key={t.id}>
                                  {t.name}
                                  <TagSource tag={t} />
                                </span>
                              ))}
                              {f.tags.length > 2 && (
                                <small>+{f.tags.length - 2}</small>
                              )}
                            </span>
                            <span className="list-date">
                              {date(f.modified)}
                            </span>
                            <span className="list-size">{size(f.bytes)}</span>
                          </button>
                        )}
                      </FileTagsHover>
                    </div>
                  );
                })}
              </div>
            )}
            {hasMore && (
              <div className="load-more">
                <button
                  className="button quiet"
                  onClick={onMore}
                  disabled={loading}
                >
                  {loading ? <LoaderCircle className="spin" size={16} /> : null}
                  加载更多 · 已显示 {files.length} / {total}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function TagPicker({
  tags,
  onPick,
  onCreate,
  placeholder = "添加标签",
  busy = false,
}: {
  tags: Tag[];
  onPick: (tag: Tag) => void;
  onCreate: (name: string) => void;
  placeholder?: string;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const choices = tags
    .filter((t) =>
      t.name.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()),
    )
    .slice(0, 7);
  const exact = tags.find(
    (t) => t.name.toLocaleLowerCase() === text.trim().toLocaleLowerCase(),
  );
  function submit() {
    if (!text.trim()) return;
    if (exact) onPick(exact);
    else onCreate(text.trim());
    setText("");
    setOpen(false);
  }
  return (
    <div className="tag-picker" ref={root}>
      <div className="tag-input">
        <Plus size={14} />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              setOpen(false);
              e.stopPropagation();
            }
          }}
        />
      </div>
      {open && (
        <div className="tag-options">
          {choices.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onPick(t);
                setText("");
                setOpen(false);
              }}
            >
              <span>
                # {t.name}
                <TagSource tag={t} pool />
              </span>
              <small>{t.count}</small>
            </button>
          ))}
          {text.trim() && !exact && (
            <button className="create-tag" onClick={submit}>
              <Plus size={14} />
              创建“{text.trim()}”
            </button>
          )}
          {!text.trim() && !choices.length && (
            <div className="subtle">输入标签名称，按 Enter 创建</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Inspector({
  files,
  tags,
  draft,
  onNote,
  onFlush,
  onReloadNote,
  onTag,
  onCreateTag,
  onOpen,
  onReveal,
  onCopy,
  onRelink,
  onPreview,
  onAnalyze,
  onCancelAI,
  onConfirmAI,
  onConfigureAI,
  busy,
}: {
  files: LocalFile[];
  tags: Tag[];
  draft?: Draft;
  onNote: (text: string) => void;
  onFlush: () => void;
  onReloadNote: () => void;
  onTag: (tag: Tag, add: boolean) => void;
  onCreateTag: (name: string) => void;
  onOpen: () => void;
  onReveal: () => void;
  onCopy: () => void;
  onRelink: () => void;
  onPreview: () => void;
  onAnalyze: () => void;
  onCancelAI: () => void;
  onConfirmAI: (tag: Tag) => void;
  onConfigureAI: () => void;
  busy: boolean;
}) {
  const f = files[0];
  const [tab, setTab] = useState("annotation");
  const tagsContainer = useRef<HTMLDivElement>(null);
  const allTags = [
    ...new Map(files.flatMap((f) => f.tags).map((t) => [t.id, t])).values(),
  ];
  useTagArrival(tagsContainer, files.map((f) => f.id).join(":"), allTags);
  const analyzing = files.some(
    (file) =>
      file.aiTask?.status === "queued" || file.aiTask?.status === "running",
  );
  const retry = files.some(
    (file) =>
      file.aiTask?.status === "failed" || file.aiTask?.status === "cancelled",
  );
  if (!f)
    return (
      <aside className="inspector inspector-empty">
        <Tags size={32} strokeWidth={1} />
        <p>选择文件查看标注</p>
      </aside>
    );
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span>{files.length > 1 ? "批量标注" : "文件详情"}</span>
        <small>
          {files.length > 1 ? `${files.length} 个文件` : kindNames[f.kind]}
        </small>
      </div>
      {files.length === 1 ? (
        <>
          <button
            className="detail-preview"
            onClick={onPreview}
            aria-label="放大预览"
          >
            <Preview file={f} />
            <span className="preview-expand">
              <Maximize2 size={14} />
            </span>
            {f.kind === "pdf" && <span className="pdf-first">PDF 首页</span>}
          </button>
          <h2 className="detail-filename">{f.name}</h2>
          <div className="detail-meta">
            {size(f.bytes)}
            <span>·</span>
            {date(f.modified)}
            <span
              className={`availability ${f.status === "available" ? "good" : "bad"}`}
            >
              {statusNames[f.status]}
            </span>
          </div>
          {f.status !== "available" && (
            <div className="inline-warning">
              <AlertCircle size={16} />
              <span>
                {f.error}
                <button onClick={onRelink}>重新关联文件</button>
              </span>
            </div>
          )}
          <div className="detail-actions">
            <button
              className="button primary"
              onClick={onOpen}
              disabled={f.status !== "available"}
            >
              <ArrowUpRight size={15} />
              打开文件
            </button>
            <button
              className="icon-button bordered"
              aria-label="在文件夹中显示"
              title="在文件夹中显示"
              onClick={onReveal}
            >
              <FolderOpen size={16} />
            </button>
            <button
              className="icon-button bordered"
              aria-label="复制文件路径"
              title="复制路径"
              onClick={onCopy}
            >
              <Copy size={15} />
            </button>
          </div>
          <div className="detail-tabs">
            <button
              className={tab === "annotation" ? "active" : ""}
              onClick={() => setTab("annotation")}
            >
              标注
            </button>
            <button
              className={tab === "info" ? "active" : ""}
              onClick={() => setTab("info")}
            >
              文件信息
            </button>
          </div>
        </>
      ) : (
        <div className="batch-summary">
          <div className="batch-glyph">
            <CheckCheck size={30} />
          </div>
          <h2>已选择 {files.length} 个文件</h2>
          <p>标签将应用到全部所选文件</p>
        </div>
      )}
      {tab === "annotation" || files.length > 1 ? (
        <>
          <div className="inspector-ai">
            <div className="inspector-ai-actions">
              <button
                className="button quiet"
                disabled={busy || analyzing}
                onClick={onAnalyze}
                title="更新待确认的 AI 标签，保留手工、文件夹及已确认标签"
              >
                <Sparkles size={14} />
                AI{" "}
                {analyzing
                  ? "识别中"
                  : retry
                    ? "重试识别"
                    : files.length > 1
                      ? "批量识别"
                      : f.aiTask
                        ? "重新识别"
                        : "识别"}
              </button>
              <button className="quiet-link" onClick={onConfigureAI}>
                设置
              </button>
            </div>
            <AiTaskStatus files={files} busy={busy} onCancel={onCancelAI} />
          </div>
          <div className="field-heading">
            <label>标签</label>
            <span>{allTags.length}</span>
          </div>
          <div className="editable-tags" ref={tagsContainer}>
            {allTags.map((t) => {
              const count = files.filter((f) =>
                f.tags.some((x) => x.id === t.id),
              ).length;
              return (
                <span
                  className="editable-tag"
                  key={t.id}
                  data-motion-tag={t.id}
                >
                  <span>{t.name}</span>
                  {files.length === 1 && <TagSource tag={t} />}
                  {files.length > 1 &&
                    files.some((f) =>
                      f.tags.some(
                        (x) =>
                          x.id === t.id &&
                          x.source === "ai" &&
                          !x.ai?.confirmed,
                      ),
                    ) && (
                      <span
                        className="source-badge source-ai"
                        title="部分文件由 AI 标注"
                      >
                        AI
                      </span>
                    )}
                  {files.length === 1 &&
                    t.source === "ai" &&
                    !t.ai?.confirmed && (
                      <button
                        aria-label={`确认AI标签${t.name}`}
                        title="确认后，重新识别也会保留此标签"
                        disabled={busy}
                        onClick={() => onConfirmAI(t)}
                      >
                        <Check size={12} />
                      </button>
                    )}
                  {files.length > 1 && count !== files.length && (
                    <small>
                      {count}/{files.length}
                    </small>
                  )}
                  {count !== files.length && (
                    <button
                      aria-label={`将${t.name}添加到全部`}
                      onClick={() => onTag(t, true)}
                      disabled={busy}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                  <button
                    aria-label={`移除标签${t.name}`}
                    onClick={() => onTag(t, false)}
                    disabled={busy}
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
          <TagPicker
            tags={tags}
            onPick={(t) => onTag(t, true)}
            onCreate={onCreateTag}
            busy={busy}
          />
          {files.length === 1 && draft && (
            <>
              <div className="field-heading">
                <label htmlFor="file-note">备注</label>
                <span className={draft.error ? "error-label" : ""}>
                  {draft.saving
                    ? "保存中…"
                    : draft.error
                      ? "保存失败"
                      : draft.text !== draft.saved
                        ? "待保存"
                        : "已保存"}
                </span>
              </div>
              <textarea
                id="file-note"
                className="note-input"
                placeholder="为什么保存这份文件？记下用途、想法或下一步。"
                value={draft.text}
                onChange={(e) => onNote(e.target.value)}
                onBlur={onFlush}
                maxLength={20000}
              />
              <span className="note-caption">仅在本机保存 · 自动保存备注</span>
              {draft.error && (
                <div className="note-error" role="alert">
                  {draft.error}
                  <div>
                    <button onClick={onFlush}>重试保存</button>
                    <button onClick={onReloadNote}>重新读取备注</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <dl className="file-properties">
          <dt>完整路径</dt>
          <dd className="full-path">{f.path}</dd>
          <dt>文件类型</dt>
          <dd>{f.extension.toUpperCase() || "未知类型"}</dd>
          <dt>文件大小</dt>
          <dd>{size(f.bytes)}</dd>
          <dt>修改时间</dt>
          <dd>{new Date(f.modified).toLocaleString("zh-CN")}</dd>
          <dt>加入时间</dt>
          <dd>{new Date(f.added).toLocaleString("zh-CN")}</dd>
          <dt>文件关联</dt>
          <dd>
            <button className="button quiet" onClick={onRelink}>
              <Link2 size={14} />
              重新关联
            </button>
          </dd>
        </dl>
      )}
    </aside>
  );
}

export function QuickTagPanel({
  tags,
  count,
  onApply,
  onManage,
}: {
  tags: Tag[];
  count: number;
  onApply: (name: string) => Promise<void>;
  onManage: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const exact = tags.find(
    (t) => t.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  async function apply(value: string) {
    if (!value.trim() || lock.current || (!count && exact)) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await onApply(value.trim());
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="modal-content quick-tag-panel">
      <p className="muted">
        {count ? `应用到 ${count} 个所选文件` : "新建到标签库"}
      </p>
      <form
        className="manager-create"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(name);
        }}
      >
        <input
          autoFocus
          aria-label="标签名称"
          placeholder={count ? "搜索或新建标签" : "新标签名称"}
          value={name}
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing)
              e.preventDefault();
          }}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="button primary"
          disabled={pending || !name.trim() || (!count && !!exact)}
        >
          {pending ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Plus size={15} />
          )}{" "}
          {count ? "添加" : "创建"}
        </button>
      </form>
      {error && (
        <p className="tag-form-error" role="alert">
          {error}
        </p>
      )}
      {count > 0 ? (
        <div className="quick-tag-choices">
          {tags
            .filter((t) =>
              t.name
                .toLocaleLowerCase()
                .includes(name.trim().toLocaleLowerCase()),
            )
            .map((t) => (
              <button
                key={t.id}
                disabled={pending}
                onClick={() => void apply(t.name)}
              >
                <Tags size={14} />
                <span>{t.name}</span>
              </button>
            ))}
          {!tags.length && <p className="muted">输入名称即可新建并标注</p>}
        </div>
      ) : (
        exact && <p className="muted">此标签已存在</p>
      )}
      <button
        className="button quiet quick-tag-manage"
        disabled={pending}
        onClick={onManage}
      >
        <Edit3 size={14} />
        管理标签
      </button>
    </div>
  );
}

export function TagManager({
  tags,
  initialTag,
  onCreate,
  onRename,
  onDelete,
  onExport,
  busy,
}: {
  tags: Tag[];
  initialTag?: Tag;
  onCreate: (s: string) => Promise<void>;
  onRename: (t: Tag, s: string) => Promise<void>;
  onDelete: (t: Tag) => void;
  onExport: (t: Tag) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(initialTag?.id || "");
  const [value, setValue] = useState(initialTag?.name || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const disabled = busy || pending;
  async function submit(task: () => Promise<void>, done: () => void) {
    if (lock.current || busy) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await task();
      done();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="modal-content">
      <p className="muted">重命名会同步到所有关联文件</p>
      <form
        className="manager-create"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim())
            void submit(
              () => onCreate(query.trim()),
              () => setQuery(""),
            );
        }}
      >
        <input
          aria-label="新标签名称"
          placeholder="搜索或新建标签"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing)
              e.preventDefault();
          }}
        />
        <button className="button primary" disabled={disabled || !query.trim()}>
          <Plus size={15} />
          创建
        </button>
      </form>
      {error && (
        <p className="tag-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="tag-manager-list">
        {tags
          .filter(
            (t) =>
              t.id === editing ||
              t.name
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
          )
          .map((t) => (
            <div className="tag-manager-row" key={t.id}>
              <Tags size={16} />
              {editing === t.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (value.trim())
                      void submit(
                        () => onRename(t, value.trim()),
                        () => setEditing(""),
                      );
                  }}
                >
                  <input
                    autoFocus
                    aria-label="标签新名称"
                    value={value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.nativeEvent.isComposing)
                        e.preventDefault();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        if (!disabled) {
                          setEditing("");
                          setError("");
                        }
                      }
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label="确认重命名"
                    title="保存"
                    disabled={disabled || !value.trim()}
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="取消重命名"
                    title="取消"
                    disabled={disabled}
                    onClick={() => {
                      setEditing("");
                      setError("");
                    }}
                  >
                    <X size={16} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    className="manager-tag-name"
                    title="重命名标签"
                    aria-label={`重命名${t.name}`}
                    disabled={disabled}
                    onClick={() => {
                      setEditing(t.id);
                      setValue(t.name);
                      setError("");
                    }}
                  >
                    <span>{t.name}</span>
                    <TagSource tag={t} pool />
                    <Edit3 size={13} />
                  </button>
                  <small>{t.count} 个文件</small>
                  <button
                    className="icon-button"
                    title="导出此标签的文件"
                    aria-label={`导出标签${t.name}的文件`}
                    disabled={disabled || t.count === 0}
                    onClick={() => onExport(t)}
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除${t.name}`}
                    onClick={() => onDelete(t)}
                    disabled={disabled}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
      {tags.length === 0 && <div className="simple-empty">暂无标签</div>}
    </div>
  );
}

export function SettingsPanel({
  boot,
  theme,
  setTheme,
  density,
  setDensity,
  onBackup,
  onRestore,
  onPackageExport,
  onPackageImport,
  onClear,
  onData,
  busy,
}: {
  boot: Bootstrap;
  theme: string;
  setTheme: (s: string) => void;
  density: string;
  setDensity: (s: string) => void;
  onBackup: () => void;
  onRestore: () => void;
  onPackageExport: () => void;
  onPackageImport: () => void;
  onClear: () => void;
  onData: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-content settings-content">
      <section>
        <h3>外观</h3>
        <div className="setting-row">
          <div>
            <strong>外观</strong>
            <p>跟随系统，或选择固定主题</p>
          </div>
          <div className="segmented">
            {[
              ["system", Monitor, "系统"],
              ["light", Sun, "浅色"],
              ["dark", Moon, "深色"],
            ].map(([value, Icon, label]) => {
              const I = Icon as typeof Sun;
              return (
                <button
                  key={String(value)}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(String(value))}
                >
                  <I size={14} />
                  {String(label)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>文件卡片密度</strong>
            <p>调整浏览时的留白</p>
          </div>
          <select
            aria-label="文件卡片密度"
            value={density}
            onChange={(e) => setDensity(e.target.value)}
          >
            <option value="comfortable">舒展</option>
            <option value="compact">紧凑</option>
          </select>
        </div>
      </section>
      <AutoTagSettings
        folderEnabled={boot.settings.folderAutoTagging !== false}
      />
      <section>
        <h3>资料交接</h3>
        <p className="muted">携带原文件、标签、备注与收藏，接收后直接使用。</p>
        <div className="settings-buttons">
          <button className="button" onClick={onPackageExport} disabled={busy}>
            <Download size={16} />
            导出资料包
          </button>
          <button className="button" onClick={onPackageImport} disabled={busy}>
            <Upload size={16} />
            导入资料包
          </button>
        </div>
      </section>
      <section>
        <h3>备份与恢复</h3>
        <p className="muted">
          备份包含标签、备注和文件位置。原文件需另行备份。
        </p>
        <div className="settings-buttons">
          <button className="button" onClick={onBackup} disabled={busy}>
            <Download size={16} />
            导出标注备份
          </button>
          <button className="button" onClick={onRestore} disabled={busy}>
            <Upload size={16} />
            从备份恢复
          </button>
        </div>
        <p className="subtle">恢复前会自动保存当前库的备份。</p>
      </section>
      <section>
        <h3>本地存储</h3>
        <div className="setting-row">
          <div>
            <strong>预览缓存</strong>
            <p>清理后会自动生成，标签和原文件不受影响</p>
          </div>
          <button className="button quiet" onClick={onClear} disabled={busy}>
            <RefreshCw size={14} />
            清理
          </button>
        </div>
        <div className="data-location">
          <HardDrive size={16} />
          <span>{boot.dataPath}</span>
          <button
            className="icon-button"
            onClick={onData}
            aria-label="打开数据目录"
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </section>
      <div className="about-line">
        <span>拾签 {boot.version}</span>
        <span>本地优先 · 无需账号</span>
      </div>
    </div>
  );
}

export function ImportDetails({ job }: { job: ImportJob }) {
  return (
    <div className="modal-content">
      <div className="import-counts">
        <span>
          <strong>{job.added}</strong>新增
        </span>
        <span>
          <strong>{job.existing}</strong>已存在
        </span>
        <span>
          <strong>{job.skipped}</strong>跳过
        </span>
        <span>
          <strong>{job.failed}</strong>失败
        </span>
      </div>
      <p className="muted">
        {job.cancelled
          ? "任务已取消，已加入的文件保留。"
          : job.done
            ? "加入完成。原文件保持在原位置。"
            : "正在读取文件信息，缩略图会按需生成。"}
      </p>
      <p className="subtle">
        隐藏文件、系统文件、链接目录及应用自身数据会跳过。
      </p>
      {job.errors.length > 0 && (
        <ul className="import-errors">
          {job.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
