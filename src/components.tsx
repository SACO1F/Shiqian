import { useEffect, useRef, useState, type ReactNode } from "react";
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
} from "./api";
import { Preview } from "./preview";
import { Draft } from "./notes";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("[autofocus],input,button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
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
            onClick={onClose}
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
  const [width, setWidth] = useState(700);
  useEffect(() => {
    if (!scroll.current) return;
    const obs = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    obs.observe(scroll.current);
    return () => obs.disconnect();
  }, []);
  const columns =
    view === "list" ? 1 : Math.max(1, Math.floor((width - 40) / 210));
  const rowHeight = view === "list" ? 68 : density === "compact" ? 208 : 246;
  const virtual = useVirtualizer({
    count: Math.ceil(files.length / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  });
  useEffect(() => {
    virtual.measure();
  }, [rowHeight, columns]);
  return (
    <div
      className="file-area"
      ref={scroll}
      role="listbox"
      aria-label="文件结果"
      aria-multiselectable="true"
      tabIndex={0}
      onScroll={() => {
        const el = scroll.current;
        if (
          el &&
          hasMore &&
          !loading &&
          el.scrollHeight - el.scrollTop - el.clientHeight < 400
        )
          onMore();
      }}
    >
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
          <div
            className="virtual-space"
            style={{ height: virtual.getTotalSize() }}
          >
            {virtual.getVirtualItems().map((row) => (
              <div
                className={`virtual-row ${view === "list" ? "list-row" : "grid-row"}`}
                key={row.key}
                style={{
                  transform: `translateY(${row.start}px)`,
                  height: rowHeight,
                  gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
                }}
              >
                {files
                  .slice(row.index * columns, (row.index + 1) * columns)
                  .map((f) => (
                    <button
                      key={f.id}
                      data-file-id={f.id}
                      className={`file-card ${view === "list" ? "file-list" : ""} ${selected.includes(f.id) ? "is-selected" : ""} ${f.status !== "available" ? "is-unavailable" : ""}`}
                      role="option"
                      aria-selected={selected.includes(f.id)}
                      aria-label={f.name}
                      onClick={(e) => onSelect(f, e)}
                      onDoubleClick={() => onOpen(f)}
                    >
                      <span className="file-art">
                        <Preview file={f} compact={view === "list"} />
                        {view === "grid" && (
                          <>
                            <span className="file-kind">
                              {f.extension.toUpperCase() || "FILE"}
                            </span>
                            {selected.includes(f.id) && (
                              <span className="selection-check">
                                <Check size={13} />
                              </span>
                            )}
                            {f.favorite && (
                              <span className="favorite-mark">
                                <Star size={13} fill="currentColor" />
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      <span className="file-description">
                        <span className="file-name" title={f.name}>
                          {f.name}
                          {view === "list" && f.favorite && (
                            <Star size={12} fill="currentColor" />
                          )}
                        </span>
                        <span className="file-subline" title={f.path}>
                          {f.status !== "available"
                            ? statusNames[f.status]
                            : view === "list"
                              ? f.parent
                              : `${size(f.bytes)} · ${date(f.modified)}`}
                        </span>
                        {view === "grid" && (
                          <span className="card-tags">
                            {f.tags.length ? (
                              f.tags
                                .slice(0, 3)
                                .map((t) => <span key={t.id}>{t.name}</span>)
                            ) : (
                              <span className="untagged">待添加标签</span>
                            )}
                            {f.tags.length > 3 && (
                              <span>+{f.tags.length - 3}</span>
                            )}
                          </span>
                        )}
                      </span>
                      {view === "list" && (
                        <>
                          <span className="list-tags">
                            {f.tags.slice(0, 2).map((t) => (
                              <span className="tag-pill" key={t.id}>
                                {t.name}
                              </span>
                            ))}
                            {f.tags.length > 2 && (
                              <small>+{f.tags.length - 2}</small>
                            )}
                          </span>
                          <span className="list-date">{date(f.modified)}</span>
                          <span className="list-size">{size(f.bytes)}</span>
                        </>
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </div>
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
              <span># {t.name}</span>
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
  busy: boolean;
}) {
  const f = files[0];
  const [tab, setTab] = useState("annotation");
  if (!f)
    return (
      <aside className="inspector inspector-empty">
        <Tags size={32} strokeWidth={1} />
        <h3>文件的另一种索引</h3>
        <p>
          选中一份文件，
          <br />
          添加标签，记下它的用途。
        </p>
      </aside>
    );
  const allTags = [
    ...new Map(files.flatMap((f) => f.tags).map((t) => [t.id, t])).values(),
  ];
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
          <p>
            添加标签会应用到全部所选文件。
            <br />
            部分文件已有的标签会标明数量。
          </p>
        </div>
      )}
      {tab === "annotation" || files.length > 1 ? (
        <>
          <div className="field-heading">
            <label>标签</label>
            <span>{allTags.length}</span>
          </div>
          <div className="editable-tags">
            {allTags.map((t) => {
              const count = files.filter((f) =>
                f.tags.some((x) => x.id === t.id),
              ).length;
              return (
                <span className="editable-tag" key={t.id}>
                  <span>{t.name}</span>
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

export function TagManager({
  tags,
  onCreate,
  onRename,
  onDelete,
  busy,
}: {
  tags: Tag[];
  onCreate: (s: string) => void;
  onRename: (t: Tag, s: string) => void;
  onDelete: (t: Tag) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="modal-content">
      <p className="muted">
        标签将不同位置的文件联系起来。重命名会同步更新所有关联。
      </p>
      <div className="manager-create">
        <input
          aria-label="新标签名称"
          placeholder="输入标签名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              query.trim()
            ) {
              onCreate(query);
              setQuery("");
            }
          }}
        />
        <button
          className="button primary"
          disabled={busy || !query.trim()}
          onClick={() => {
            onCreate(query);
            setQuery("");
          }}
        >
          <Plus size={15} />
          创建
        </button>
      </div>
      <div className="tag-manager-list">
        {tags
          .filter((t) => t.name.includes(query) || !query)
          .map((t) => (
            <div className="tag-manager-row" key={t.id}>
              <Tags size={16} />
              {editing === t.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(t, value);
                    setEditing("");
                  }}
                >
                  <input
                    autoFocus
                    aria-label="标签新名称"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <button
                    className="icon-button"
                    aria-label="确认重命名"
                    disabled={busy}
                  >
                    <Check size={16} />
                  </button>
                </form>
              ) : (
                <>
                  <span className="manager-tag-name">{t.name}</span>
                  <small>{t.count} 个文件</small>
                  <button
                    className="icon-button"
                    aria-label={`重命名${t.name}`}
                    onClick={() => {
                      setEditing(t.id);
                      setValue(t.name);
                    }}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除${t.name}`}
                    onClick={() => onDelete(t)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
      {tags.length === 0 && (
        <div className="simple-empty">
          还没有标签。可以从一个项目名或用途开始。
        </div>
      )}
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
  onClear: () => void;
  onData: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-content settings-content">
      <section>
        <h3>让工作台适合你的习惯</h3>
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
      <section>
        <h3>保存你的整理成果</h3>
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
