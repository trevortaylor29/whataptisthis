"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
  /** Reject files larger than this BEFORE downscaling, to keep memory sane. */
  maxRawFileSizeMb?: number;
}

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXTS = ".jpg,.jpeg,.png,.webp";

const MAX_DIM = 1280; // long edge, in px
const JPEG_QUALITY = 0.82;

export default function ScreenshotUploader({
  value,
  onChange,
  disabled = false,
  max = 3,
  maxRawFileSizeMb = 25,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingSlots = Math.max(0, max - value.length);
  const isFull = remainingSlots === 0;

  const acceptFiles = useCallback(
    async (files: FileList | File[]) => {
      if (disabled) return;
      setError(null);

      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const usable: File[] = [];
      for (const f of incoming) {
        if (!ACCEPTED_MIME.includes(f.type)) {
          setError(`"${f.name}" is not a JPG/PNG/WebP image.`);
          continue;
        }
        if (f.size > maxRawFileSizeMb * 1024 * 1024) {
          setError(`"${f.name}" is larger than ${maxRawFileSizeMb}MB.`);
          continue;
        }
        usable.push(f);
      }

      if (usable.length === 0) return;

      const slice = usable.slice(0, remainingSlots);
      if (usable.length > remainingSlots) {
        setError(`Only ${max} screenshots max — kept the first ${remainingSlots}.`);
      }

      setBusy(true);
      try {
        const dataUrls = await Promise.all(
          slice.map((f) => fileToCompressedDataUrl(f, MAX_DIM, JPEG_QUALITY)),
        );
        onChange([...value, ...dataUrls]);
      } catch (e) {
        setError(`Couldn't process image: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [disabled, max, maxRawFileSizeMb, onChange, remainingSlots, value],
  );

  // Clipboard paste support (desktop). Listens at the document level so the
  // user doesn't have to focus the drop zone first — they just Ctrl/⌘+V from
  // anywhere on the page. We only call preventDefault when the clipboard
  // actually contains an image, so pasting text into other fields still works.
  useEffect(() => {
    if (disabled || isFull) return;

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return; // text-only paste — let it through

      e.preventDefault();
      void acceptFiles(files);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, isFull, acceptFiles]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void acceptFiles(e.target.files);
      // Allow re-selecting the same file later
      e.target.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      void acceptFiles(e.dataTransfer.files);
    }
  }

  function removeAt(idx: number) {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone — hidden once max reached */}
      {!isFull && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors",
            disabled && "cursor-not-allowed opacity-60",
            dragOver
              ? "border-accent bg-ink-900"
              : "border-ink-700 bg-ink-800 hover:border-ink-600 hover:bg-ink-900",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <UploadIcon className={dragOver ? "text-accent" : "text-ink-300"} />
          <div className="text-sm">
            <span className="font-medium text-ink-100">
              {value.length === 0 ? "Drop screenshots" : "Add another"}
            </span>{" "}
            <span className="text-ink-400">
              or tap to choose
              <span className="hidden sm:inline">
                {" "}&middot; paste with{" "}
                <kbd className="rounded border border-ink-600 bg-ink-900/60 px-1 py-0.5 font-mono text-[10px] text-ink-200">
                  Ctrl
                </kbd>
                /
                <kbd className="rounded border border-ink-600 bg-ink-900/60 px-1 py-0.5 font-mono text-[10px] text-ink-200">
                  ⌘
                </kbd>{" "}
                +{" "}
                <kbd className="rounded border border-ink-600 bg-ink-900/60 px-1 py-0.5 font-mono text-[10px] text-ink-200">
                  V
                </kbd>
              </span>
            </span>
          </div>
          <p className="text-xs text-ink-400">
            JPG, PNG, WebP &middot; up to {max} images
            {value.length > 0 && (
              <>
                {" "}&middot;{" "}
                <span className="text-ink-300">
                  {value.length}/{max} added
                </span>
              </>
            )}
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_EXTS}
            multiple
            disabled={disabled || busy}
            onChange={handleInputChange}
            className="sr-only"
          />
        </label>
      )}

      {/* Counter when full */}
      {isFull && (
        <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-sm text-ink-300">
          <span>
            <span className="font-medium text-ink-100">{value.length}/{max}</span>{" "}
            screenshots added — remove one to add another.
          </span>
        </div>
      )}

      {/* Thumbnails */}
      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {value.map((src, i) => (
            <li
              key={i}
              className="group relative aspect-square overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Screenshot ${i + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label={`Remove screenshot ${i + 1}`}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-ink-900/80 text-ink-100 opacity-0 transition-opacity hover:bg-ink-800 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed sm:opacity-100 sm:bg-ink-900/60"
              >
                <CloseIcon />
              </button>
              <span className="absolute bottom-1.5 left-1.5 rounded bg-ink-900/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-300">
                {i + 1}
              </span>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-xs text-ink-300">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Processing image…
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-amber-400">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image processing helper
//
// We always re-encode to JPEG at a sensible size: phone photos are commonly
// 3-5MB, which means 3 of them blow past Next's 10MB body limit AND wastes
// money in vision tokens (most providers charge per image tile). 1280px on
// the long edge at q=0.82 keeps OCR-quality clarity while landing each
// image in the ~150-400KB range.
// ---------------------------------------------------------------------------

async function fileToCompressedDataUrl(
  file: File,
  maxDim: number,
  quality: number,
): Promise<string> {
  const sourceUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

  const img = await loadImage(sourceUrl);

  let { width, height } = img;
  const longest = Math.max(width, height);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Icons (inline so we don't pull in an icon library)
// ---------------------------------------------------------------------------

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <path
        d="M12 16V4M12 4L7 9M12 4L17 9M5 20H19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 3L11 11M11 3L3 11"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
