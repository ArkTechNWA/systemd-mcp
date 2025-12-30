/**
 * A.L.A.N. Database Layer (As Long As Necessary)
 *
 * Persistent memory for NEVERHANG v2.0:
 * - Circuit breaker state survives restarts
 * - Command history for adaptive timeout learning
 * - Health check logs for trend analysis
 *
 * Auto-cleanup keeps it lean:
 * - Command history: 7 days
 * - Health checks: 24 hours
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface CircuitStateRow {
  id: number;
  state: "closed" | "open" | "half_open";
  failure_count: number;
  last_failure_at: number | null;
  opened_at: number | null;
  recovery_successes: number;
  updated_at: number;
}

export interface CommandHistoryRow {
  id: number;
  tool_name: string;
  category: string;
  duration_ms: number;
  success: number;
  error_type: string | null;
  executed_at: number;
}

export interface HealthCheckRow {
  id: number;
  status: string;
  latency_ms: number | null;
  ping_success: number;
  checked_at: number;
}

const SCHEMA_VERSION = 1;

/**
 * Initialize the A.L.A.N. database
 * Location: ~/.cache/systemd-mcp/neverhang.db (XDG compliant)
 */
export function initDatabase(): Database.Database {
  // XDG compliant: ~/.cache/systemd-mcp/
  const cacheDir = process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "systemd-mcp")
    : join(homedir(), ".cache", "systemd-mcp");

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const dbPath = join(cacheDir, "neverhang.db");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and crash recovery
  db.pragma("journal_mode = WAL");

  // Initialize schema
  db.exec(`
    -- Circuit breaker state (singleton - survives restarts)
    CREATE TABLE IF NOT EXISTS circuit_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL DEFAULT 'closed',
      failure_count INTEGER DEFAULT 0,
      last_failure_at INTEGER,
      opened_at INTEGER,
      recovery_successes INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    -- Command execution history (adaptive timeout learning)
    CREATE TABLE IF NOT EXISTS command_history (
      id INTEGER PRIMARY KEY,
      tool_name TEXT NOT NULL,
      category TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      success INTEGER NOT NULL,
      error_type TEXT,
      executed_at INTEGER NOT NULL
    );

    -- Health check log (trend analysis)
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      ping_success INTEGER NOT NULL,
      checked_at INTEGER NOT NULL
    );

    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    -- Indexes for A.L.A.N. cleanup queries
    CREATE INDEX IF NOT EXISTS idx_history_executed ON command_history(executed_at);
    CREATE INDEX IF NOT EXISTS idx_health_checked ON health_checks(checked_at);
    CREATE INDEX IF NOT EXISTS idx_history_category ON command_history(category);
  `);

  // Ensure singleton circuit state row exists
  db.prepare(`
    INSERT OR IGNORE INTO circuit_state (id, state, updated_at)
    VALUES (1, 'closed', ?)
  `).run(Date.now());

  // Track schema version
  db.prepare(`INSERT OR IGNORE INTO schema_version (version) VALUES (?)`).run(
    SCHEMA_VERSION
  );

  // Run A.L.A.N. cleanup on startup
  cleanupOldData(db);

  console.error(`[ALAN] Database initialized: ${dbPath}`);
  return db;
}

/**
 * A.L.A.N. Cleanup - prune old data to keep database lean
 * - Command history: 7 days
 * - Health checks: 24 hours
 */
export function cleanupOldData(db: Database.Database): void {
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const cmdDeleted = db
    .prepare(`DELETE FROM command_history WHERE executed_at < ?`)
    .run(now - WEEK_MS);
  const healthDeleted = db
    .prepare(`DELETE FROM health_checks WHERE checked_at < ?`)
    .run(now - DAY_MS);

  if (cmdDeleted.changes > 0 || healthDeleted.changes > 0) {
    console.error(
      `[ALAN] Cleanup: removed ${cmdDeleted.changes} old commands, ${healthDeleted.changes} old health checks`
    );
  }
}

/**
 * Load circuit state from database
 */
export function loadCircuitState(db: Database.Database): CircuitStateRow {
  return db
    .prepare(`SELECT * FROM circuit_state WHERE id = 1`)
    .get() as CircuitStateRow;
}

/**
 * Save circuit state to database
 */
export function saveCircuitState(
  db: Database.Database,
  state: Partial<CircuitStateRow>
): void {
  db.prepare(
    `
    UPDATE circuit_state SET
      state = COALESCE(?, state),
      failure_count = COALESCE(?, failure_count),
      last_failure_at = ?,
      opened_at = ?,
      recovery_successes = COALESCE(?, recovery_successes),
      updated_at = ?
    WHERE id = 1
  `
  ).run(
    state.state ?? null,
    state.failure_count ?? null,
    state.last_failure_at ?? null,
    state.opened_at ?? null,
    state.recovery_successes ?? null,
    Date.now()
  );
}

/**
 * Record a command execution
 */
export function recordCommand(
  db: Database.Database,
  toolName: string,
  category: string,
  durationMs: number,
  success: boolean,
  errorType?: string
): void {
  db.prepare(
    `
    INSERT INTO command_history (tool_name, category, duration_ms, success, error_type, executed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(toolName, category, durationMs, success ? 1 : 0, errorType ?? null, Date.now());
}

/**
 * Record a health check
 */
export function recordHealthCheck(
  db: Database.Database,
  status: string,
  latencyMs: number | null,
  pingSuccess: boolean
): void {
  db.prepare(
    `
    INSERT INTO health_checks (status, latency_ms, ping_success, checked_at)
    VALUES (?, ?, ?, ?)
  `
  ).run(status, latencyMs, pingSuccess ? 1 : 0, Date.now());
}

/**
 * Get P95 latency for a category (last 100 successful commands)
 */
export function getP95Latency(
  db: Database.Database,
  category: string
): number | null {
  const rows = db
    .prepare(
      `
    SELECT duration_ms FROM command_history
    WHERE category = ? AND success = 1
    ORDER BY executed_at DESC
    LIMIT 100
  `
    )
    .all(category) as { duration_ms: number }[];

  if (rows.length < 10) return null; // Not enough data
  const sorted = rows.map((r) => r.duration_ms).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

/**
 * Get success rate for last hour
 */
export function getRecentSuccessRate(db: Database.Database): number {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const row = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(success) as successes
    FROM command_history
    WHERE executed_at > ?
  `
    )
    .get(hourAgo) as { total: number; successes: number };

  if (row.total === 0) return 1.0;
  return row.successes / row.total;
}

/**
 * Get database statistics for health endpoint
 */
export interface DatabaseStats {
  commands_24h: number;
  success_rate_24h: number;
  avg_latency_by_category: Record<string, number>;
  health_trend: Array<{
    status: string;
    latency_ms: number | null;
    ago: string;
  }>;
}

export function getDatabaseStats(db: Database.Database): DatabaseStats {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Command stats for last 24h
  const cmdStats = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(success) as successes,
      category,
      AVG(duration_ms) as avg_duration
    FROM command_history
    WHERE executed_at > ?
    GROUP BY category
  `
    )
    .all(dayAgo) as Array<{
    total: number;
    successes: number;
    category: string;
    avg_duration: number;
  }>;

  // Health trend (last 10 checks)
  const healthTrend = db
    .prepare(
      `
    SELECT status, latency_ms, checked_at
    FROM health_checks
    ORDER BY checked_at DESC
    LIMIT 10
  `
    )
    .all() as Array<{
    status: string;
    latency_ms: number | null;
    checked_at: number;
  }>;

  const total = cmdStats.reduce((sum, c) => sum + c.total, 0);
  const successes = cmdStats.reduce((sum, c) => sum + c.successes, 0);

  return {
    commands_24h: total,
    success_rate_24h: total > 0 ? successes / total : 1.0,
    avg_latency_by_category: Object.fromEntries(
      cmdStats.map((c) => [c.category, Math.round(c.avg_duration)])
    ),
    health_trend: healthTrend.map((h) => ({
      status: h.status,
      latency_ms: h.latency_ms,
      ago: `${Math.round((Date.now() - h.checked_at) / 60000)}m`,
    })),
  };
}

/**
 * Close database gracefully
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
  console.error("[ALAN] Database closed");
}
