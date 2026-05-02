import { ensureSchema, getPool } from "@/lib/db";

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export type RestoreGateResult =
  | { ok: true }
  | { ok: false; blockedUntil: Date };

/**
 * Blocks restore when blocked_until is in the future (set after 3 failed restores).
 * Clears an expired block so the IP can try again after 24h.
 */
export async function assertRestoreAllowed(ip: string): Promise<RestoreGateResult> {
  await ensureSchema();
  const pool = getPool();
  const now = new Date();

  const r = await pool.query(
    `SELECT blocked_until FROM restore_ip_limits WHERE ip = $1`,
    [ip],
  );
  if (r.rows.length === 0) return { ok: true };

  const blockedUntilRaw = (r.rows[0] as { blocked_until: string | null })
    .blocked_until;
  if (!blockedUntilRaw) return { ok: true };

  const until = new Date(blockedUntilRaw);
  if (Number.isNaN(until.getTime())) return { ok: true };

  if (until > now) {
    return { ok: false, blockedUntil: until };
  }

  await pool.query(
    `UPDATE restore_ip_limits SET blocked_until = NULL, failure_count = 0 WHERE ip = $1`,
    [ip],
  );
  return { ok: true };
}

/**
 * Records a failed restore (no credits moved). Resets the counter at UTC midnight.
 * On the 3rd failure in the same UTC day, sets blocked_until to now + 24h.
 */
export async function recordRestoreFailure(ip: string): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  const day = utcDayKey();
  const blockedUntilIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT utc_day, failure_count FROM restore_ip_limits WHERE ip = $1 FOR UPDATE`,
      [ip],
    );

    let failures: number;

    if (r.rows.length === 0) {
      failures = 1;
      await client.query(
        `INSERT INTO restore_ip_limits (ip, utc_day, failure_count, blocked_until)
         VALUES ($1, $2, $3, NULL)`,
        [ip, day, failures],
      );
    } else {
      const row = r.rows[0] as { utc_day: string; failure_count: number };
      if (row.utc_day !== day) {
        failures = 1;
        await client.query(
          `UPDATE restore_ip_limits SET utc_day = $1, failure_count = 1, blocked_until = NULL WHERE ip = $2`,
          [day, ip],
        );
      } else {
        failures = Number(row.failure_count) + 1;
        await client.query(
          `UPDATE restore_ip_limits SET failure_count = $1 WHERE ip = $2`,
          [failures, ip],
        );
      }
    }

    if (failures >= 3) {
      await client.query(
        `UPDATE restore_ip_limits SET blocked_until = $1 WHERE ip = $2`,
        [blockedUntilIso, ip],
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

/** Clears failure streak after a successful credit transfer. */
export async function recordRestoreSuccess(ip: string): Promise<void> {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `UPDATE restore_ip_limits SET failure_count = 0, blocked_until = NULL WHERE ip = $1`,
    [ip],
  );
}
