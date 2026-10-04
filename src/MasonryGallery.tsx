import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Star, AlertCircle } from "lucide-react";
import { type LocalFile, statusNames } from "./api";
import { Preview } from "./preview";

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
  const [ratio, setRatio] = useState(file.kind === "pdf" ? 0.707 : 4 / 3);
  const card = useRef<HTMLButtonElement>(null);
  const visual = file.kind === "image" || file.kind === "pdf";
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
    <button
      ref={card}
      data-file-id={file.id}
      className={`file-card masonry-card ${selected ? "is-selected" : ""} ${file.status !== "available" ? "is-unavailable" : ""}`}
      role="option"
      aria-label={file.name}
      aria-selected={selected}
      onClick={(event) => onSelect(file, event)}
      onDoubleClick={() => onOpen(file)}
    >
      <span className="masonry-art" style={{ aspectRatio: ratio }}>
        <Preview
          file={file}
          onDimensions={(width, height) => {
            if (width > 0 && height > 0) setRatio(width / height);
          }}
        />
        {selected && (
          <span className="selection-check">
            <Check size={14} />
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
        {visual && (
          <span className="gallery-caption">
            <span className="file-name">{file.name}</span>
            {!!file.tags.length && (
              <span className="gallery-tags">
                {file.tags
                  .slice(0, 3)
                  .map((tag) => tag.name)
                  .join(" · ")}
              </span>
            )}
          </span>
        )}
      </span>
      {!visual && <span className="gallery-document-name">{file.name}</span>}
    </button>
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
}: {
  files: LocalFile[];
  scroll: RefObject<HTMLDivElement | null>;
  width: number;
  columns: number;
  gap: number;
  selected: string[];
  onSelect: (file: LocalFile, event: MouseEvent) => void;
  onOpen: (file: LocalFile) => void;
}) {
  const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
  const gallery = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: files.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) =>
      `${files[index].id}:${files[index].revision}:${files[index].identity}:${files[index].status}`,
    estimateSize: (index) =>
      columnWidth * (files[index].kind === "pdf" ? 1.414 : 0.75) +
      (files[index].kind === "image" || files[index].kind === "pdf" ? 0 : 44),
    lanes: columns,
    laneAssignmentMode: "measured",
    gap,
    overscan: columns * 2,
  });
  const onSizeChange = useCallback(
    (index: number, height: number) => virtual.resizeItem(index, height),
    [virtual],
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
