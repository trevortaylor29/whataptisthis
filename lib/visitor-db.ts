import { getPool, ensureSchema } from "@/lib/db";

/** Daily IP cap (UTC calendar day), persisted in PostgreSQL. */
export const IP_DAILY_MAX = 10;

export type ScanAccessTier = "full" | "lite";

export interface VisitorRow {
  fingerprint: string;
  ip: string;
  free_scans_used: number;
  /** Anchor month for free tier reset (UTC). */
  free_scan_reset_date: string;
  paid_credits: number;
  stripe_customer_email: string | null;
  stripe_session_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ScanRow {
  id: number;
  fingerprint: string;
  tiktok_url: string;
  city: string;
  scan_tier: "lite" | "full";
  top_match: string;
  confidence: number;
  created_at: string;
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcMonth(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSessionIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
}

function mapVisitorRow(r: Record<string, unknown>): VisitorRow {
  return {
    fingerprint: String(r.fingerprint),
    ip: r.ip != null ? String(r.ip) : "",
    free_scans_used: Number(r.free_scans_used ?? 0),
    free_scan_reset_date: String(r.free_scan_reset_date ?? ""),
    paid_credits: Number(r.paid_credits ?? 0),
    stripe_customer_email:
      r.stripe_customer_email != null
        ? String(r.stripe_customer_email)
        : null,
    stripe_session_ids: parseSessionIds(
      r.stripe_session_ids != null ? String(r.stripe_session_ids) : "[]",
    ),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function needsMonthlyReset(
  freeScanResetDate: string,
  now: Date,
): boolean {
  const anchor = new Date(freeScanResetDate);
  if (
    Number.isNaN(anchor.getTime()) ||
    anchor.getUTCFullYear() !== now.getUTCFullYear() ||
    anchor.getUTCMonth() !== now.getUTCMonth()
  ) {
    return true;
  }
  return false;
}

/** Applies monthly free reset in DB when needed; returns current row. */
async function ensureMonthlyResetForFingerprint(
  fingerprint: string,
): Promise<void> {
  const pool = getPool();
  const now = new Date();
  const r = await pool.query(
    `SELECT free_scan_reset_date FROM visitors WHERE fingerprint = $1`,
    [fingerprint],
  );
  if (r.rows.length === 0) return;
  const raw = r.rows[0] as { free_scan_reset_date: string | null };
  const anchorStr = raw.free_scan_reset_date ?? "";
  if (!needsMonthlyReset(anchorStr, now)) return;

  const newAnchor = startOfUtcMonth(now).toISOString();
  await pool.query(
    `UPDATE visitors SET free_scans_used = 0, free_scan_reset_date = $1, updated_at = $2
     WHERE fingerprint = $3`,
    [newAnchor, nowIso(), fingerprint],
  );
}

export async function getOrCreateVisitor(
  fingerprint: string,
  ip: string,
): Promise<VisitorRow> {
  await ensureSchema();
  const pool = getPool();
  const fp = fingerprint.trim();
  const now = new Date();
  const anchor = startOfUtcMonth(now).toISOString();
  const ts = nowIso();

  const existing = await pool.query(
    `SELECT * FROM visitors WHERE fingerprint = $1`,
    [fp],
  );
  if (existing.rows.length > 0) {
    let rec = mapVisitorRow(existing.rows[0] as Record<string, unknown>);
    if (needsMonthlyReset(rec.free_scan_reset_date, now)) {
      await pool.query(
        `UPDATE visitors SET ip = $1, free_scans_used = 0, free_scan_reset_date = $2, updated_at = $3
         WHERE fingerprint = $4`,
        [ip, anchor, ts, fp],
      );
      rec = {
        ...rec,
        free_scans_used: 0,
        free_scan_reset_date: anchor,
        ip,
        updated_at: ts,
      };
    } else {
      await pool.query(
        `UPDATE visitors SET ip = $1, updated_at = $2 WHERE fingerprint = $3`,
        [ip, ts, fp],
      );
      rec = { ...rec, ip, updated_at: ts };
    }
    return rec;
  }

  await pool.query(
    `INSERT INTO visitors (
       fingerprint, ip, free_scans_used, free_scan_reset_date, paid_credits,
       stripe_customer_email, stripe_session_ids, created_at, updated_at
     ) VALUES ($1, $2, 0, $3, 0, NULL, '[]', $4, $4)`,
    [fp, ip, anchor, ts],
  );

  const again = await pool.query(
    `SELECT * FROM visitors WHERE fingerprint = $1`,
    [fp],
  );
  return mapVisitorRow(again.rows[0] as Record<string, unknown>);
}

export type CreditsScanTier = "full" | "lite" | "blocked";

export async function getCreditsSnapshot(
  fingerprint: string | undefined,
): Promise<{
  freeScansRemaining: number;
  paidCredits: number;
  scanTier: CreditsScanTier;
}> {
  if (!fingerprint || fingerprint.trim().length === 0) {
    return { freeScansRemaining: 0, paidCredits: 0, scanTier: "blocked" };
  }

  await ensureSchema();
  const fp = fingerprint.trim();
  await ensureMonthlyResetForFingerprint(fp);

  const pool = getPool();
  const r = await pool.query(`SELECT * FROM visitors WHERE fingerprint = $1`, [
    fp,
  ]);

  if (r.rows.length === 0) {
    return { freeScansRemaining: 1, paidCredits: 0, scanTier: "lite" };
  }

  const rec = mapVisitorRow(r.rows[0] as Record<string, unknown>);
  const freeRemaining = Math.max(0, 1 - rec.free_scans_used);

  if (rec.paid_credits > 0) {
    return {
      freeScansRemaining: freeRemaining,
      paidCredits: rec.paid_credits,
      scanTier: "full",
    };
  }
  if (freeRemaining > 0) {
    return {
      freeScansRemaining: freeRemaining,
      paidCredits: 0,
      scanTier: "lite",
    };
  }
  return { freeScansRemaining: 0, paidCredits: 0, scanTier: "blocked" };
}

export type ConsumeResult =
  | { ok: true; tier: ScanAccessTier }
  | {
      ok: false;
      code: "NO_CREDITS" | "IP_RATE_LIMIT";
      message: string;
    };

/**
 * Read-only fast path before starting the analyze pipeline (no charge yet).
 */
export async function precheckScanAccess(
  fingerprint: string | undefined,
  ip: string,
  opts?: { bypass?: boolean },
): Promise<ConsumeResult> {
  if (opts?.bypass) {
    return { ok: true, tier: "full" };
  }

  if (!fingerprint || fingerprint.trim().length === 0) {
    return {
      ok: false,
      code: "NO_CREDITS",
      message: "Visitor id missing. Reload the page and try again.",
    };
  }

  await ensureSchema();
  const pool = getPool();
  const day = utcDayKey(new Date());
  const fp = fingerprint.trim();

  await pruneStaleIpRows(pool);

  const ipRow = await pool.query(
    `SELECT request_count FROM ip_daily_counts WHERE ip = $1 AND utc_day = $2`,
    [ip, day],
  );
  const ipToday = Number(ipRow.rows[0]?.request_count ?? 0);
  if (ipToday >= IP_DAILY_MAX) {
    return {
      ok: false,
      code: "IP_RATE_LIMIT",
      message: `Too many searches from this network today (${IP_DAILY_MAX} max). Try again tomorrow.`,
    };
  }

  await ensureMonthlyResetForFingerprint(fp);

  const vr = await pool.query(
    `SELECT paid_credits, free_scans_used FROM visitors WHERE fingerprint = $1`,
    [fp],
  );

  if (vr.rows.length === 0) {
    return { ok: true, tier: "lite" };
  }

  const row = vr.rows[0] as {
    paid_credits: number;
    free_scans_used: number;
  };
  const paid = Number(row.paid_credits ?? 0);
  const freeUsed = Number(row.free_scans_used ?? 0);

  if (paid > 0) {
    return { ok: true, tier: "full" };
  }
  if (freeUsed < 1) {
    return { ok: true, tier: "lite" };
  }

  return {
    ok: false,
    code: "NO_CREDITS",
    message: "Free scan used. Purchase credits for more scans.",
  };
}

async function pruneStaleIpRows(pool: ReturnType<typeof getPool>): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 4);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  await pool.query(`DELETE FROM ip_daily_counts WHERE utc_day < $1`, [
    cutoffDay,
  ]);
}

/**
 * Applies IP limit + consumes credits for the tier that was actually run (call after a successful analyze).
 * Pass `tier` from precheck so a full pipeline cannot accidentally consume a free scan (and vice versa).
 */
export async function finalizeScanAccess(
  fingerprint: string | undefined,
  ip: string,
  opts?: { bypass?: boolean; tier?: ScanAccessTier },
): Promise<ConsumeResult> {
  if (opts?.bypass) {
    return { ok: true, tier: "full" };
  }

  if (!fingerprint || fingerprint.trim().length === 0) {
    return {
      ok: false,
      code: "NO_CREDITS",
      message: "Visitor id missing. Reload the page and try again.",
    };
  }

  const tier = opts?.tier;
  if (!tier) {
    throw new Error("finalizeScanAccess requires opts.tier when not bypassing");
  }

  await ensureSchema();
  const pool = getPool();
  const fp = fingerprint.trim();
  const now = new Date();
  const day = utcDayKey(now);
  const anchor = startOfUtcMonth(now).toISOString();
  const ts = nowIso();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM ip_daily_counts WHERE utc_day < $1`, [
      (() => {
        const c = new Date();
        c.setUTCDate(c.getUTCDate() - 4);
        return c.toISOString().slice(0, 10);
      })(),
    ]);

    const ipLock = await client.query(
      `SELECT request_count FROM ip_daily_counts WHERE ip = $1 AND utc_day = $2 FOR UPDATE`,
      [ip, day],
    );
    const ipToday = Number(ipLock.rows[0]?.request_count ?? 0);
    if (ipToday >= IP_DAILY_MAX) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        code: "IP_RATE_LIMIT",
        message: `Too many searches from this network today (${IP_DAILY_MAX} max). Try again tomorrow.`,
      };
    }

    let vRow = await client.query(
      `SELECT * FROM visitors WHERE fingerprint = $1 FOR UPDATE`,
      [fp],
    );

    if (vRow.rows.length === 0) {
      await client.query(
        `INSERT INTO visitors (
           fingerprint, ip, free_scans_used, free_scan_reset_date, paid_credits,
           stripe_customer_email, stripe_session_ids, created_at, updated_at
         ) VALUES ($1, $2, 0, $3, 0, NULL, '[]', $4, $4)`,
        [fp, ip, anchor, ts],
      );
      vRow = await client.query(
        `SELECT * FROM visitors WHERE fingerprint = $1 FOR UPDATE`,
        [fp],
      );
    }

    let rec = mapVisitorRow(vRow.rows[0] as Record<string, unknown>);
    if (needsMonthlyReset(rec.free_scan_reset_date, now)) {
      await client.query(
        `UPDATE visitors SET free_scans_used = 0, free_scan_reset_date = $1, updated_at = $2
         WHERE fingerprint = $3`,
        [anchor, ts, fp],
      );
      rec = {
        ...rec,
        free_scans_used: 0,
        free_scan_reset_date: anchor,
        updated_at: ts,
      };
    }

    const bumpIp = async () => {
      await client.query(
        `INSERT INTO ip_daily_counts (ip, utc_day, request_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (ip, utc_day) DO UPDATE SET
           request_count = ip_daily_counts.request_count + 1`,
        [ip, day],
      );
    };

    if (tier === "full") {
      if (rec.paid_credits <= 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: "NO_CREDITS",
          message:
            "Could not confirm paid credits for this scan. Refresh and check your balance.",
        };
      }
      await client.query(
        `UPDATE visitors SET paid_credits = paid_credits - 1, ip = $1, updated_at = $2 WHERE fingerprint = $3`,
        [ip, ts, fp],
      );
      await bumpIp();
      await client.query("COMMIT");
      return { ok: true, tier: "full" };
    }

    // lite
    if (rec.free_scans_used >= 1) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        code: "NO_CREDITS",
        message: "Free scan used. Purchase credits for more scans.",
      };
    }
    await client.query(
      `UPDATE visitors SET free_scans_used = free_scans_used + 1, ip = $1, updated_at = $2 WHERE fingerprint = $3`,
      [ip, ts, fp],
    );
    await bumpIp();
    await client.query("COMMIT");
    return { ok: true, tier: "lite" };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function appendScan(
  row: Omit<ScanRow, "id" | "created_at">,
): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO scans (fingerprint, tiktok_url, city, scan_tier, top_match, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.fingerprint,
      row.tiktok_url,
      row.city,
      row.scan_tier,
      row.top_match,
      row.confidence,
    ],
  );
}

export async function addPaidCredits(
  fingerprint: string,
  amount: number,
  sessionId: string,
  email: string | null,
): Promise<void> {
  if (amount <= 0) return;
  await ensureSchema();
  const pool = getPool();
  const fp = fingerprint.trim();
  const now = new Date();
  const anchor = startOfUtcMonth(now).toISOString();
  const ts = nowIso();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT * FROM visitors WHERE fingerprint = $1 FOR UPDATE`,
      [fp],
    );

    if (r.rows.length === 0) {
      const sessionIds = JSON.stringify([sessionId]);
      await client.query(
        `INSERT INTO visitors (
           fingerprint, ip, free_scans_used, free_scan_reset_date, paid_credits,
           stripe_customer_email, stripe_session_ids, created_at, updated_at
         ) VALUES ($1, 'unknown', 0, $2, $3, $4, $5, $6, $6)`,
        [fp, anchor, amount, email, sessionIds, ts],
      );
    } else {
      const ids = parseSessionIds(
        (r.rows[0] as { stripe_session_ids?: string }).stripe_session_ids,
      );
      if (!ids.includes(sessionId)) ids.push(sessionId);
      await client.query(
        `UPDATE visitors SET
           paid_credits = paid_credits + $1,
           stripe_customer_email = COALESCE($2, stripe_customer_email),
           stripe_session_ids = $3,
           updated_at = $4
         WHERE fingerprint = $5`,
        [amount, email, JSON.stringify(ids), ts, fp],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function setVisitorEmail(
  fingerprint: string,
  email: string,
): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `UPDATE visitors SET stripe_customer_email = $1, updated_at = $2 WHERE fingerprint = $3`,
    [email, nowIso(), fingerprint.trim()],
  );
}

/**
 * Merge paid_credits from all visitors with this email into `targetFingerprint`.
 */
export async function restoreCreditsByEmail(
  email: string,
  targetFingerprint: string,
): Promise<{ restored: boolean; credits: number }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { restored: false, credits: 0 };

  await ensureSchema();
  const pool = getPool();
  const target = targetFingerprint.trim();
  const ts = nowIso();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const others = await client.query(
      `SELECT fingerprint, paid_credits FROM visitors
       WHERE lower(trim(stripe_customer_email)) = $1 AND fingerprint <> $2 AND paid_credits > 0
       FOR UPDATE`,
      [normalized, target],
    );

    let transferred = 0;
    for (const row of others.rows as { fingerprint: string; paid_credits: number }[]) {
      transferred += Number(row.paid_credits ?? 0);
      await client.query(
        `UPDATE visitors SET paid_credits = 0, updated_at = $1 WHERE fingerprint = $2`,
        [ts, row.fingerprint],
      );
    }

    if (transferred === 0) {
      await client.query("ROLLBACK");
      return { restored: false, credits: 0 };
    }

    const tr = await client.query(
      `SELECT * FROM visitors WHERE fingerprint = $1 FOR UPDATE`,
      [target],
    );

    if (tr.rows.length === 0) {
      const anchor = startOfUtcMonth(new Date()).toISOString();
      await client.query(
        `INSERT INTO visitors (
           fingerprint, ip, free_scans_used, free_scan_reset_date, paid_credits,
           stripe_customer_email, stripe_session_ids, created_at, updated_at
         ) VALUES ($1, 'unknown', 0, $2, $3, $4, '[]', $5, $5)`,
        [target, anchor, transferred, normalized, ts],
      );
    } else {
      await client.query(
        `UPDATE visitors SET
           paid_credits = paid_credits + $1,
           stripe_customer_email = COALESCE(stripe_customer_email, $2),
           updated_at = $3
         WHERE fingerprint = $4`,
        [transferred, normalized, ts, target],
      );
    }

    await client.query("COMMIT");
    return { restored: true, credits: transferred };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
