import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

/**
 * The video itself is never written to disk — ffmpeg streams it directly
 * from the network URL, decodes it, and writes only the extracted JPEG
 * frames into a short-lived temp directory which we delete on the way out.
 */

// Resolved at runtime from the platform-specific binary shipped with @ffmpeg-installer/ffmpeg
// (Linux on Vercel, Windows locally). Use require so Next/webpack externalizes this package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFMPEG_PATH = require("@ffmpeg-installer/ffmpeg").path as string;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_FRAME_WIDTH = 720;
const DEFAULT_JPEG_Q = 5; // ffmpeg quality scale: 2 = best, 31 = worst

/** Max seconds of video to decode at 2 fps (safety for long files). */
const MAX_CLIP_SECONDS_FOR_INTERVAL_EXTRACTION = 120;

/**
 * Maximum video frames passed to the vision model. When ffmpeg produces more,
 * {@link evenlySpaceFrames} picks this many evenly spaced samples (endpoints included).
 */
export const MAX_VISION_FRAMES = 10;

/** @deprecated Use {@link MAX_VISION_FRAMES}. */
export const MAX_FRAMES_AFTER_DEDUP = MAX_VISION_FRAMES;

export type FrameExtractionStrategy =
  | "every_half_second"
  /** @deprecated Use `every_half_second` (same behavior: 2 fps). */
  | "one_per_second"
  | "evenly_spaced";

export interface ExtractFramesOptions {
  /**
   * `every_half_second` — ffmpeg **fps=2**, then {@link evenlySpaceFrames} to
   * {@link MAX_VISION_FRAMES}. `evenly_spaced` — legacy N frames over duration.
   */
  strategy?: FrameExtractionStrategy;
  /** Used only for `evenly_spaced`. Ignored for interval strategies. */
  count?: number;
  /** Approximate clip duration in seconds. */
  durationSec?: number | null;
  /** Per-call timeout for the entire ffmpeg invocation. */
  timeoutMs?: number;
  /** Override max seconds to read for `every_half_second` (default from duration or 90). */
  maxClipSeconds?: number;
  /** Override max frames to vision after subsampling (default {@link MAX_VISION_FRAMES}). */
  maxVisionFrames?: number;
}

export interface FrameExtractionResult {
  /** `data:image/jpeg;base64,...` — ordered chronologically after subsampling. */
  frames: string[];
  /** Anything ffmpeg wrote to stderr. Useful for debugging. */
  ffmpegLog: string;
  /**
   * JPEG count read from disk after ffmpeg (`every_half_second` only), before
   * subsampling. Omitted when unknown or evenly_spaced without subsampling.
   */
  rawExtractedFrameCount?: number;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (!m) throw new Error("Invalid data URL for frame");
  return Buffer.from(m[2]!.replace(/\s/g, ""), "base64");
}

/**
 * If `frames.length` exceeds `maxFrames`, return exactly `maxFrames` evenly spaced
 * picks (first and last included). Otherwise return a copy of all frames.
 * No similarity checks — temporal spacing only.
 */
export function evenlySpaceFrames<T>(frames: T[], maxFrames: number): T[] {
  if (frames.length === 0) return [];
  if (frames.length <= maxFrames) return [...frames];
  if (maxFrames === 1) return [frames[0]!];
  const n = frames.length;
  const out: T[] = [];
  for (let k = 0; k < maxFrames; k++) {
    const idx = Math.round((k * (n - 1)) / (maxFrames - 1));
    out.push(frames[idx]!);
  }
  return out;
}

/**
 * Extract JPEG frames from a remote video URL using ffmpeg.
 * The full video file is never persisted — ffmpeg pulls it from the network
 * and writes only the JPEG frames into a short-lived temp directory we control.
 *
 * Throws on ffmpeg failure (caller decides how to surface it). Always cleans
 * up the temp directory.
 */
export async function extractFramesFromUrl(
  videoUrl: string,
  opts: ExtractFramesOptions = {},
): Promise<FrameExtractionResult> {
  const strategyRaw = opts.strategy ?? "every_half_second";
  const strategy =
    strategyRaw === "one_per_second" ? "every_half_second" : strategyRaw;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxVision = opts.maxVisionFrames ?? MAX_VISION_FRAMES;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "apt-frames-"));
  try {
    if (strategy === "every_half_second") {
      const duration =
        opts.durationSec && opts.durationSec > 0 ? opts.durationSec : null;
      const clipSeconds = Math.min(
        opts.maxClipSeconds ??
          Math.ceil(duration ?? 90),
        MAX_CLIP_SECONDS_FOR_INTERVAL_EXTRACTION,
      );

      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "warning",
          "-y",
          "-analyzeduration",
          "10M",
          "-probesize",
          "20M",
          "-user_agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "-i",
          videoUrl,
          "-t",
          String(Math.max(1, clipSeconds)),
          "-vf",
          `fps=2,scale=${DEFAULT_FRAME_WIDTH}:-2:flags=bilinear`,
          "-q:v",
          String(DEFAULT_JPEG_Q),
          path.join(tmpDir, "frame_%03d.jpg"),
        ],
        { timeoutMs },
      );
    } else {
      const count = Math.max(1, Math.min(maxVision, opts.count ?? 10));
      const assumedDuration =
        opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 30;
      const fps = Math.max(0.1, count / assumedDuration);

      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "warning",
          "-y",
          "-analyzeduration",
          "10M",
          "-probesize",
          "20M",
          "-user_agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "-i",
          videoUrl,
          "-vf",
          `fps=${fps},scale=${DEFAULT_FRAME_WIDTH}:-2:flags=bilinear`,
          "-frames:v",
          String(count),
          "-q:v",
          String(DEFAULT_JPEG_Q),
          path.join(tmpDir, "frame_%03d.jpg"),
        ],
        { timeoutMs },
      );
    }

    const files = (await fs.readdir(tmpDir))
      .filter((f) => /^frame_\d+\.jpg$/.test(f))
      .sort();

    const frames: string[] = [];
    for (const f of files) {
      try {
        const buf = await fs.readFile(path.join(tmpDir, f));
        if (buf.byteLength > 0) {
          frames.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
        }
      } catch {
        // Ignore unreadable frames — skip and continue.
      }
    }

    if (frames.length === 0) {
      throw new Error("ffmpeg produced zero usable frames");
    }

    if (strategy === "every_half_second") {
      const rawExtractedFrameCount = frames.length;
      const sampled = evenlySpaceFrames(frames, maxVision);
      return {
        frames: sampled,
        ffmpegLog: "",
        rawExtractedFrameCount,
      };
    }

    return {
      frames,
      ffmpegLog: "",
      rawExtractedFrameCount: frames.length,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Write vision frames as `frame_001.jpg`, … under a new temp directory (debug).
 */
export async function saveVisionFramesToDebugDirectory(
  frames: string[],
): Promise<{ dir: string; filenames: string[] }> {
  if (frames.length === 0) {
    throw new Error("No frames to save");
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apt-debug-frames-"));
  const filenames: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const name = `frame_${String(i + 1).padStart(3, "0")}.jpg`;
    const buf = dataUrlToBuffer(frames[i]!);
    await fs.writeFile(path.join(dir, name), buf);
    filenames.push(name);
  }
  return { dir, filenames };
}

/** @deprecated Use {@link saveVisionFramesToDebugDirectory}. */
export const saveDedupedFramesToDebugDirectory = saveVisionFramesToDebugDirectory;

/** Downscaled JPEG data URL for debug UI (smaller JSON than full frames). */
export async function createThumbnailDataUrl(
  dataUrl: string,
  maxWidth: number,
): Promise<string> {
  const buf = dataUrlToBuffer(dataUrl);
  const out = await sharp(buf)
    .resize(maxWidth, null, { withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

export async function fetchThumbnailAsDataUrl(
  thumbnailUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxBytes = opts.maxBytes ?? 2_000_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(thumbnailUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ApartmentDecoder/0.1; +https://apartment-decoder.local)",
        Accept: "image/jpeg,image/webp,image/png,image/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const mime = ct.split(";")[0].trim();
    if (!/^image\//.test(mime)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function runFfmpeg(
  args: string[],
  opts: { timeoutMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `ffmpeg timed out after ${opts.timeoutMs}ms${stderr ? `: ${stderr.slice(-300)}` : ""}`,
        ),
      );
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpeg exited with code ${code}${stderr ? `: ${stderr.slice(-300)}` : ""}`,
          ),
        );
      }
    });
  });
}
