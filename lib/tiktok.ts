import type { VideoMetadata } from "./types";

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const TIKTOK_VIDEO_ID_RE = /\/video\/(\d{6,25})/;
const TIKTOK_SHORT_URL_RE = /^https?:\/\/(vm|vt)\.tiktok\.com\//i;

function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.matchAll(HASHTAG_RE);
  return Array.from(matches, (m) => m[1]);
}

function detectPlatform(url: string): "tiktok" | "instagram" | "unknown" {
  try {
    const u = new URL(url);
    if (u.hostname.includes("tiktok")) return "tiktok";
    if (u.hostname.includes("instagram")) return "instagram";
    return "unknown";
  } catch {
    return "unknown";
  }
}

interface TikTokOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

/**
 * TikTok video IDs are Snowflake-style integers. The high 32 bits encode the
 * Unix epoch *seconds* the post was created. Returns null if the ID isn't
 * parseable or the decoded timestamp falls outside a reasonable window
 * (TikTok launched in 2016 — anything before 2014 or far in the future is
 * a parse error, not a real date).
 */
export function videoIdToCreationDate(videoId: string): Date | null {
  try {
    const id = BigInt(videoId);
    const seconds = Number(id >> 32n);
    if (seconds < 1388534400 || seconds > 4102444800) return null; // 2014 → 2100
    return new Date(seconds * 1000);
  } catch {
    return null;
  }
}

export function extractTikTokVideoId(url: string): string | null {
  const m = url.match(TIKTOK_VIDEO_ID_RE);
  return m ? m[1] : null;
}

/**
 * Short URLs (vm.tiktok.com / vt.tiktok.com) hide the numeric video ID behind
 * a redirect. Follow the redirect to recover the canonical URL so we can pull
 * the creation date.
 */
async function resolveTikTokShortUrl(url: string): Promise<string> {
  if (!TIKTOK_SHORT_URL_RE.test(url)) return url;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ApartmentDecoder/0.1; +https://apartment-decoder.local)",
      },
    });
    return res.url || url;
  } catch {
    return url;
  }
}

function monthsBetween(then: Date, now: Date = new Date()): number {
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

/**
 * tikwm.com is an unofficial, free TikTok video-info endpoint. We hit it to
 * recover a direct no-watermark MP4 URL plus a duration value, both of which
 * we feed into ffmpeg for frame extraction. Returns null on any failure —
 * callers fall back to the oEmbed thumbnail.
 */
export interface TikwmDownload {
  videoUrl: string;
  durationSec: number | null;
  cover: string | null;
}

export async function fetchTikwmDownload(
  tiktokUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<TikwmDownload | null> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ApartmentDecoder/0.1; +https://apartment-decoder.local)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: number;
      data?: {
        play?: string;
        wmplay?: string;
        hdplay?: string;
        duration?: number;
        cover?: string;
        origin_cover?: string;
      };
    };
    if (json.code !== 0 || !json.data) return null;
    const videoUrl = json.data.hdplay || json.data.play || json.data.wmplay;
    if (!videoUrl) return null;
    return {
      videoUrl,
      durationSec:
        typeof json.data.duration === "number" && json.data.duration > 0
          ? json.data.duration
          : null,
      cover: json.data.cover ?? json.data.origin_cover ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort metadata extraction. We hit TikTok's public oEmbed endpoint
 * for caption / creator / thumbnail, then attempt to recover a downloadable
 * MP4 URL via tikwm. The downloaded MP4 itself is consumed by the route
 * (see lib/video-frames.ts) — this function only enriches the metadata.
 */
export async function extractVideoMetadata(
  url: string,
  opts?: { skipVideoDownload?: boolean },
): Promise<VideoMetadata> {
  const platform = detectPlatform(url);
  const base: VideoMetadata = {
    caption: null,
    hashtags: [],
    creator: null,
    thumbnailUrl: null,
    frames: [],
    source: platform,
  };

  if (platform === "tiktok") {
    const resolved = await resolveTikTokShortUrl(url);
    const videoId = extractTikTokVideoId(resolved);
    const created = videoId ? videoIdToCreationDate(videoId) : null;
    const dateFields: Pick<
      VideoMetadata,
      "videoId" | "creationDate" | "ageMonths"
    > = {
      videoId: videoId,
      creationDate: created ? created.toISOString() : null,
      ageMonths: created ? monthsBetween(created) : null,
    };

    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const res = await fetch(oembedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ApartmentDecoder/0.1; +https://apartment-decoder.local)",
        },
      });
      if (!res.ok) {
        return {
          ...base,
          ...dateFields,
          extractionError: `TikTok oEmbed returned ${res.status}`,
        };
      }
      const data = (await res.json()) as TikTokOEmbed;
      const caption = data.title ?? null;

      // Best-effort: recover a downloadable MP4 URL via tikwm (skipped for lite
      // scans — caption-only pipeline).
      const tikwm =
        opts?.skipVideoDownload === true
          ? null
          : await fetchTikwmDownload(resolved).catch(() => null);

      return {
        ...base,
        ...dateFields,
        caption,
        hashtags: extractHashtags(caption),
        creator: data.author_name ?? null,
        thumbnailUrl: data.thumbnail_url ?? tikwm?.cover ?? null,
        videoUrl: tikwm?.videoUrl ?? null,
        durationSec: tikwm?.durationSec ?? null,
      };
    } catch (err) {
      return {
        ...base,
        ...dateFields,
        extractionError: `TikTok oEmbed failed: ${(err as Error).message}`,
      };
    }
  }

  if (platform === "instagram") {
    return {
      ...base,
      extractionError:
        "Instagram metadata extraction is not implemented in the prototype. The screenshots will still be analyzed.",
    };
  }

  return {
    ...base,
    extractionError: `Unrecognized link host: ${url}`,
  };
}
