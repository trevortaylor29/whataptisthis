/**
 * @deprecated Replaced by `lib/visitor-db.ts` (credits + IP limits + persistence).
 * Kept only for reference; not imported by the app.
 */
import fs from "fs/promises";
import path from "path";

/** Rolling window for free-tier fingerprint limit */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const FREE_SEARCHES_PER_WINDOW = 1;
/** Calendar UTC day for IP cap */
const IP_DAILY_MAX = 10;

const DATA_PATH = path.join(process.cwd(), "data", "usage.json");

export type UsageDenyCode = "FREE_TIER_LIMIT" | "IP_RATE_LIMIT";

interface VisitorRecord {
  visitorId: string;
  ip: string;
  searchCount: number;
  lastSearchDate: string;
  searches: string[];
}

interface UsageFile {
  visitors: Record<string, VisitorRecord>;
  /** key: `${ip}|YYYY-MM-DD` (UTC) → count that day */
  ipByDay: Record<string, number>;
}

let chain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function load(): Promise<UsageFile> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw) as UsageFile;
    if (!parsed.visitors) parsed.visitors = {};
    if (!parsed.ipByDay) parsed.ipByDay = {};
    return parsed;
  } catch {
    return { visitors: {}, ipByDay: {} };
  }
}

async function save(data: UsageFile): Promise<void> {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function pruneSearches(searches: string[], now: number): string[] {
  const cutoff = now - THIRTY_DAYS_MS;
  return searches.filter((s) => {
    const t = new Date(s).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
}

function pruneIpKeys(ipByDay: Record<string, number>): Record<string, number> {
  const keepDays = new Set<string>();
  const today = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    keepDays.add(utcDayKey(d));
  }
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(ipByDay)) {
    const day = k.split("|").pop();
    if (day && keepDays.has(day)) next[k] = v;
  }
  return next;
}

/**
 * Atomically checks limits and records one search. Server-side only.
 */
export async function consumeSearchSlot(
  visitorId: string | undefined,
  ip: string,
  opts?: { bypass?: boolean },
): Promise<
  | { ok: true }
  | { ok: false; code: UsageDenyCode; message: string }
> {
  if (opts?.bypass) return { ok: true };

  return withLock(async () => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const day = utcDayKey(new Date(now));

    const data = await load();
    data.ipByDay = pruneIpKeys(data.ipByDay);

    const ipKey = `${ip}|${day}`;
    const ipToday = data.ipByDay[ipKey] ?? 0;
    if (ipToday >= IP_DAILY_MAX) {
      return {
        ok: false,
        code: "IP_RATE_LIMIT",
        message: `Too many searches from this network today (${IP_DAILY_MAX} max). Try again tomorrow.`,
      };
    }

    if (visitorId && visitorId.trim().length > 0) {
      const vid = visitorId.trim();
      let rec = data.visitors[vid];
      if (!rec) {
        rec = {
          visitorId: vid,
          ip,
          searchCount: 0,
          lastSearchDate: nowIso,
          searches: [],
        };
        data.visitors[vid] = rec;
      }
      rec.searches = pruneSearches(rec.searches, now);
      if (rec.searches.length >= FREE_SEARCHES_PER_WINDOW) {
        return {
          ok: false,
          code: "FREE_TIER_LIMIT",
          message:
            "You've used your free search this month. Purchase full-result credits when checkout goes live.",
        };
      }
      rec.searches.push(nowIso);
      rec.searchCount = rec.searches.length;
      rec.lastSearchDate = nowIso;
      rec.ip = ip;
    }

    data.ipByDay[ipKey] = ipToday + 1;
    await save(data);
    return { ok: true };
  });
}
