import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Star, AlertCircle } from "lucide-react";
import { type LocalFile, statusNames } from "./api";
import { Preview, previewKey, previewRatio } from "./preview";
import { TagSource } from "./TagSource";
import { tagTone } from "./tagColors";
import { SelectionCheck, useTagArrival } from "./microMotion";

function GalleryCard({
  file,
  index,
  selected,
  onSizeChange,
  onSelect,
  onOpen,
}: {
  file: LocalFile;
  index: number;
  selected: boolean;
  onSizeChange: (index: number, height: number) => void;
  onSelect: (file: LocalFile, event: MouseEvent) => void;
  onOpen: (file: LocalFile) => void;
}) {
  const [ratio, setRatio] = useState(() => previewRatio(file));
  const card = useRef<HTMLButtonElement>(null);
  useTagArrival(card, file.id, file.tags);
  const visual = file.kind === "image" || file.kind === "pdf";
  const tags = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    // Loading a preview can change its ratio without re-rendering the gallery.
    // Update positions in the same commit, before the newly taller image paints.
    if (card.current)
      onSizeChange(
        index,
        Math.round(card.current.getBoundingClientRect().height),
      );
  }, [ratio, index, onSizeChange]);
  return (
    <>
      <button
        ref={card}
        data-file-id={file.id}
        className={`file-card masonry-card ${selected ? "is-selected" : ""} ${file.status !== "available" ? "is-unavailable" : ""}`}
        role="option"
        aria-label={file.name}
        aria-selected={selected}
        onClick={(event) => onSelect(file, event)}
        onDoubleClick={() => onOpen(file)}
        onKeyDown={(event) => {
          const list = tags.current;
          if (
            list &&
            list.scrollHeight > list.clientHeight &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
            event.stopPropagation();
            list.scrollBy(0, event.key === "ArrowDown" ? 48 : -48);
          }
        }}
      >
        <span className="masonry-art" style={{ aspectRatio: ratio }}>
          <Preview
            file={file}
            onDimensions={(width, height) => {
              if (width > 0 && height > 0) setRatio(width / height);
            }}
          />
          <SelectionCheck checked={selected} />
          {file.tags.some((t) => t.source === "ai" && !t.ai?.confirmed) && (
            <span
              className="gallery-ai-mark"
              title="包含 AI 标注，选中文件可确认或重新识别"
            >
              ✦ AI
            </span>
          )}
          {file.favorite && (
            <span className="favorite-mark">
              <Star size={13} fill="currentColor" />
            </span>
          )}
          {file.status !== "available" && (
            <span className="gallery-status">
              <AlertCircle size={13} />
              {statusNames[file.status]}
            </span>
          )}
          <span
            className="gallery-caption"
            role="region"
            aria-label={`${file.name}的全部标签`}
          >
            <span className="file-name">{file.name}</span>
            {file.tags.length > 0 && (
              <span className="gallery-tags" ref={tags}>
                {file.tags.map((tag) => (
                  <span
                    className={`gallery-tag tag-color tone-${tagTone(tag.id)}`}
                    key={tag.id}
                    data-motion-tag={tag.id}
                  >
                    <span>{tag.name}</span>
                    <TagSource tag={tag} />
                  </span>
                ))}
              </span>
            )}
          </span>
        </span>
        {!visual && <span className="gallery-document-name">{file.name}</span>}
      </button>
    </>
  );
}

export function MasonryGallery({
  files,
  scroll,
  width,
  columns,
  gap,
  selected,
  onSelect,
  onOpen,
  initialOffset,
  measurements,
}: {
  files: LocalFile[];
  scroll: RefObject<HTMLDivElement | null>;
  width: number;
  columns: number;
  gap: number;
  selected: string[];
  onSelect: (file: LocalFile, event: MouseEvent) => void;
  onOpen: (file: LocalFile) => void;
  initialOffset: number;
  measurements: RefObject<Map<string, { width: number; height: number }>>;
}) {
  const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
  const gallery = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: files.length,
    getScrollElement: () => scroll.current,
    initialOffset,
    getItemKey: (index) =>
      `${files[index].id}:${files[index].revision}:${files[index].identity}:${files[index].status}`,
    estimateSize: (index) => {
      const file = files[index];
      const cached = measurements.current.get(previewKey(file));
      if (cached && Math.abs(cached.width - columnWidth) < 1)
        return cached.height;
      return (
        columnWidth / previewRatio(file) +
        (file.kind === "image" || file.kind === "pdf" ? 0 : 44)
      );
    },
    lanes: columns,
    laneAssignmentMode: "measured",
    gap,
    overscan: columns * 2,
  });
  const onSizeChange = useCallback(
    (index: number, height: number) => {
      measurements.current.set(previewKey(files[index]), {
        width: columnWidth,
        height,
      });
      if (measurements.current.size > 1000)
        measurements.current.delete(measurements.current.keys().next().value!);
      virtual.resizeItem(index, height);
    },
    [virtual, files, columnWidth, measurements],
  );
  useLayoutEffect(() => {
    // A geometry change invalidates heights for off-screen cards too. Rebuild
    // the estimates, then restore mounted cards' actual heights before paint.
    // Clearing measurements in a passive effect can discard the ResizeObserver
    // result without another DOM resize to trigger a replacement measurement.
    virtual.measure();
    virtual.getTotalSize();
    gallery.current
      ?.querySelectorAll<HTMLDivElement>(".masonry-item")
      .forEach((element) => {
        // Read directly even while scrolling; measureElement may use its cache
        // or defer to ResizeObserver during a user scroll.
        virtual.resizeItem(
          Number(element.dataset.index),
          Math.round(element.getBoundingClientRect().height),
        );
      });
  }, [columnWidth, columns, gap, virtual]);
  return (
    <div
      ref={gallery}
      className="masonry-space"
      data-columns={columns}
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((item) => (
        <div
          key={item.key}
          ref={virtual.measureElement}
          data-index={item.index}
          className="masonry-item"
          style={{
            width: columnWidth,
            transform: `translate(${item.lane * (columnWidth + gap)}px, ${item.start}px)`,
          }}
        >
          <GalleryCard
            file={files[item.index]}
            index={item.index}
            onSizeChange={onSizeChange}
            selected={selected.includes(files[item.index].id)}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        </div>
      ))}
    </div>
  );
}
