import { useEffect, useState } from "react";
import {
  FileText,
  File,
  ImageIcon,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, LocalFile, message } from "./api";

interface PreviewData {
  kind: string;
  data?: string;
  text?: string;
  truncated?: boolean;
  revision: string;
  error?: string;
}
let active = 0;
const waiting: Array<() => void> = [];
const previews = new Map<string, Promise<PreviewData>>();
const readyPreviews = new Map<string, PreviewData>();
const ratios = new Map<string, number>();
export function previewKey(file: LocalFile) {
  return `${file.id}:${file.revision}:${file.identity}:${file.status}`;
}
export function previewRatio(file: LocalFile) {
  return ratios.get(previewKey(file)) ?? (file.kind === "pdf" ? 0.707 : 4 / 3);
}
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export function clearPreviews() {
  previews.clear();
  readyPreviews.clear();
  ratios.clear();
}
async function load(file: LocalFile, large: boolean): Promise<PreviewData> {
  const key = `${previewKey(file)}:${large}`;
  if (!previews.has(key)) {
    const promise = limited(async () => {
      const value = await api<PreviewData>("preview", { id: file.id, large });
      if (value.kind !== "pdf") return value;
      const pdf = await import("pdfjs-dist");
      pdf.GlobalWorkerOptions.workerSrc = workerUrl;
      const binary = atob(value.data!);
      const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const task = pdf.getDocument({
        data,
        useSystemFonts: true,
        cMapUrl: new URL("pdf-assets/cmaps/", document.baseURI).href,
        cMapPacked: true,
        standardFontDataUrl: new URL(
          "pdf-assets/standard_fonts/",
          document.baseURI,
        ).href,
        wasmUrl: new URL("pdf-assets/wasm/", document.baseURI).href,
      });
      try {
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = (large ? 1800 : 420) / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const encoded = canvas.toDataURL("image/png").split(",")[1];
        await api("preview.cache", {
          id: file.id,
          large,
          revision: value.revision,
          data: encoded,
        }).catch(() => {});
        return { ...value, kind: "image", data: encoded };
      } finally {
        await task.destroy();
      }
    })
      .then((value) => {
        if (previews.get(key) === promise) {
          readyPreviews.set(key, value);
          if (readyPreviews.size > 300)
            readyPreviews.delete(readyPreviews.keys().next().value!);
        }
        return value;
      })
      .catch((error) => {
        previews.delete(key);
        return {
          kind: "error",
          revision: file.revision,
          error: message(error),
        };
      });
    previews.set(key, promise);
    if (previews.size > 300) previews.delete(previews.keys().next().value!);
  }
  return previews.get(key)!;
}
export function Preview({
  file,
  large = false,
  compact = false,
  onDimensions,
}: {
  file: LocalFile;
  large?: boolean;
  compact?: boolean;
  onDimensions?: (width: number, height: number) => void;
}) {
  const key = `${previewKey(file)}:${large}`;
  const [result, setResult] = useState<PreviewData | undefined>(() =>
    readyPreviews.get(key),
  );
  useEffect(() => {
    let alive = true;
    setResult(readyPreviews.get(key));
    if (
      file.kind === "image" ||
      file.kind === "pdf" ||
      (large && file.kind === "text")
    )
      load(file, large).then((r) => {
        if (alive) setResult(r);
      });
    else setResult({ kind: "unsupported", revision: file.revision });
    return () => {
      alive = false;
    };
  }, [file.id, file.revision, file.identity, file.status, large]);
  if (!result)
    return (
      <div className="preview-placeholder">
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  if (result.kind === "image")
    return (
      <img
        className="preview-image"
        src={`data:image/png;base64,${result.data}`}
        alt={file.name}
        draggable={false}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } =
            event.currentTarget;
          if (width > 0 && height > 0) {
            ratios.set(previewKey(file), width / height);
            if (ratios.size > 300) ratios.delete(ratios.keys().next().value!);
            onDimensions?.(width, height);
          }
        }}
      />
    );
  if (result.kind === "text")
    return (
      <div className="text-preview">
        <pre>{result.text || "（空文件）"}</pre>
        {result.truncated && <small>仅预览前 200 KiB</small>}
      </div>
    );
  if (result.kind === "error")
    return (
      <div className="preview-placeholder preview-error" title={result.error}>
        <AlertCircle size={compact ? 20 : 28} />
        {!compact && <span>{large ? result.error : "无法预览"}</span>}
      </div>
    );
  const Icon =
    file.kind === "image" ? ImageIcon : file.kind === "other" ? File : FileText;
  return (
    <div className={`preview-placeholder file-type-${file.kind}`}>
      <Icon size={compact ? 23 : 40} strokeWidth={1.25} />
      {!compact && (
        <span className="extension-stamp">
          {file.extension.toUpperCase() || "FILE"}
        </span>
      )}
      {large && <small>使用默认程序打开以查看完整内容</small>}
    </div>
  );
}
