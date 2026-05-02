import { Pool } from "@neondatabase/serverless";

let pool: Pool | null = null;

let ensureSchemaPromise: Promise<void> | null = null;

/**
 * Shared Neon connection pool. Requires `DATABASE_URL`.
 */
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/**
 * Creates required tables on first use (idempotent).
 * PostgreSQL does not allow `TEXT DEFAULT CURRENT_TIMESTAMP`; timestamps are stored as text via `now()::text`.
 */
export async function ensureSchema(): Promise<void> {
  if (ensureSchemaPromise) return ensureSchemaPromise;

  const p = getPool();
  ensureSchemaPromise = (async () => {
    await p.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        fingerprint TEXT PRIMARY KEY,
        ip TEXT,
        free_scans_used INTEGER DEFAULT 0,
        free_scan_reset_date TEXT,
        paid_credits INTEGER DEFAULT 0,
        stripe_customer_email TEXT,
        stripe_session_ids TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (now()::text),
        updated_at TEXT NOT NULL DEFAULT (now()::text)
      );
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        fingerprint TEXT,
        tiktok_url TEXT,
        city TEXT,
        scan_tier TEXT,
        top_match TEXT,
        confidence INTEGER,
        created_at TEXT NOT NULL DEFAULT (now()::text)
      );
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS ip_daily_counts (
        ip TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, utc_day)
      );
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS restore_ip_limits (
        ip TEXT PRIMARY KEY,
        utc_day TEXT NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 0,
        blocked_until TEXT
      );
    `);
  })();

  return ensureSchemaPromise;
}
