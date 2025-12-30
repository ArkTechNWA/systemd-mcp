/**
 * NEVERHANG v2.0 for systemd-mcp
 * Reliability is a methodology
 *
 * Adapted from postgres-mcp with:
 * - Category-based timeouts (status/query/action/heavy/diagnostic)
 * - A.L.A.N. database integration for persistent state
 * - SSH-aware health monitoring
 */

import type Database from "better-sqlite3";
import {
  loadCircuitState,
  saveCircuitState,
  recordCommand,
  recordHealthCheck,
  getP95Latency,
  getRecentSuccessRate,
  getDatabaseStats,
  type CircuitStateRow,
  type DatabaseStats,
} from "./db.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export type CommandCategory = "status" | "query" | "action" | "heavy" | "diagnostic";

export interface NeverhangConfig {
  // Timeouts by category
  status_timeout_ms: number;
  query_timeout_ms: number;
  action_timeout_ms: number;
  heavy_timeout_ms: number;
  diagnostic_timeout_ms: number;

  // Circuit breaker
  circuit_failure_threshold: number;
  circuit_failure_window_ms: number;
  circuit_open_duration_ms: number;
  circuit_recovery_threshold: number;

  // Health monitor
  health_check_interval_ms: number;
  health_degraded_interval_ms: number;
  health_check_timeout_ms: number;

  // Adaptive timeout
  adaptive_timeout: boolean;
}

export const DEFAULT_NEVERHANG_CONFIG: NeverhangConfig = {
  // Timeouts by category
  status_timeout_ms: 5000,
  query_timeout_ms: 10000,
  action_timeout_ms: 30000,
  heavy_timeout_ms: 60000,
  diagnostic_timeout_ms: 90000,

  // Circuit breaker
  circuit_failure_threshold: 5,
  circuit_failure_window_ms: 60000,
  circuit_open_duration_ms: 30000,
  circuit_recovery_threshold: 2,

  // Health monitor
  health_check_interval_ms: 30000,
  health_degraded_interval_ms: 5000,
  health_check_timeout_ms: 2000,

  // Adaptive timeout
  adaptive_timeout: true,
};

// ============================================================================
// FAILURE TAXONOMY
// ============================================================================

export type FailureType =
  | "timeout"
  | "connection_failed"
  | "auth_failed"
  | "circuit_open"
  | "command_error"
  | "permission_denied"
  | "cancelled";

export class NeverhangError extends Error {
  readonly type: FailureType;
  readonly duration_ms: number;
  readonly retryable: boolean;
  readonly suggestion: string;

  constructor(
    type: FailureType,
    message: string,
    duration_ms: number,
    options?: { cause?: Error }
  ) {
    super(message, options);
    this.name = "NeverhangError";
    this.type = type;
    this.duration_ms = duration_ms;
    this.retryable = type !== "permission_denied" && type !== "command_error";
    this.suggestion = NeverhangError.getSuggestion(type);
  }

  static getSuggestion(type: FailureType): string {
    switch (type) {
      case "timeout":
        return "Check SSH connectivity and systemd responsiveness. Try: ssh <host> systemctl --version";
      case "connection_failed":
        return "Verify SSH host is reachable: ping <host>";
      case "auth_failed":
        return "Check SSH key configuration: ssh -v <host>";
      case "circuit_open":
        return "System marked unhealthy. Automatic retry pending.";
      case "command_error":
        return "Check unit name and systemd logs.";
      case "permission_denied":
        return "Verify systemd permissions for the SSH user.";
      case "cancelled":
        return "Command was cancelled.";
      default:
        return "Unknown error occurred.";
    }
  }

  toJSON() {
    return {
      type: this.type,
      message: this.message,
      duration_ms: this.duration_ms,
      retryable: this.retryable,
      suggestion: this.suggestion,
    };
  }
}

// ============================================================================
// HEALTH MONITOR
// ============================================================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthState {
  status: HealthStatus;
  last_check: Date | null;
  last_success: Date | null;
  last_failure: Date | null;
  latency_ms: number;
  latency_samples: number[];
  consecutive_failures: number;
  consecutive_successes: number;
}

export class HealthMonitor {
  private state: HealthState;
  private config: NeverhangConfig;
  private db: Database.Database;
  private pingFn: () => Promise<void>;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    config: NeverhangConfig,
    db: Database.Database,
    pingFn: () => Promise<void>
  ) {
    this.config = config;
    this.db = db;
    this.pingFn = pingFn;
    this.state = {
      status: "healthy", // Assume healthy until proven otherwise
      last_check: null,
      last_success: null,
      last_failure: null,
      latency_ms: 0,
      latency_samples: [],
      consecutive_failures: 0,
      consecutive_successes: 0,
    };
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const start = Date.now();
    try {
      await this.pingFn();
      const latency = Date.now() - start;
      this.recordSuccess(latency);
      return { ok: true, latency_ms: latency };
    } catch (error) {
      const latency = Date.now() - start;
      this.recordFailure();
      return { ok: false, latency_ms: latency };
    }
  }

  private recordSuccess(latency_ms: number): void {
    this.state.last_check = new Date();
    this.state.last_success = new Date();
    this.state.latency_ms = latency_ms;
    this.state.consecutive_failures = 0;
    this.state.consecutive_successes++;

    // Keep last 10 samples for p95
    this.state.latency_samples.push(latency_ms);
    if (this.state.latency_samples.length > 10) {
      this.state.latency_samples.shift();
    }

    // Log to A.L.A.N. database
    recordHealthCheck(this.db, this.state.status, latency_ms, true);

    // Status transitions
    const prevStatus = this.state.status;
    if (this.state.status === "unhealthy" && this.state.consecutive_successes >= 1) {
      this.state.status = "degraded";
    } else if (this.state.status === "degraded" && this.state.consecutive_successes >= 3) {
      this.state.status = "healthy";
    }

    if (prevStatus !== this.state.status) {
      console.error(`[neverhang] Health: ${prevStatus} -> ${this.state.status}`);
    }
  }

  private recordFailure(): void {
    this.state.last_check = new Date();
    this.state.last_failure = new Date();
    this.state.consecutive_successes = 0;
    this.state.consecutive_failures++;

    // Log to A.L.A.N. database
    recordHealthCheck(this.db, this.state.status, null, false);

    // Status transitions
    const prevStatus = this.state.status;
    if (this.state.status === "healthy" && this.state.consecutive_failures >= 1) {
      this.state.status = "degraded";
    } else if (this.state.status === "degraded" && this.state.consecutive_failures >= 3) {
      this.state.status = "unhealthy";
    }

    if (prevStatus !== this.state.status) {
      console.error(`[neverhang] Health: ${prevStatus} -> ${this.state.status}`);
    }
  }

  getHealth(): HealthState {
    return { ...this.state };
  }

  getLatencyP95(): number {
    if (this.state.latency_samples.length === 0) return 0;
    const sorted = [...this.state.latency_samples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  startBackgroundCheck(): void {
    if (this.intervalId) return;

    const check = async () => {
      await this.ping();

      // Adjust interval based on health
      const interval =
        this.state.status === "healthy"
          ? this.config.health_check_interval_ms
          : this.config.health_degraded_interval_ms;

      this.intervalId = setTimeout(check, interval);
    };

    // Start after initial delay
    this.intervalId = setTimeout(check, 5000);
    console.error("[neverhang] Background health check started");
  }

  stopBackgroundCheck(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }
}

// ============================================================================
// CIRCUIT BREAKER (with A.L.A.N. persistence)
// ============================================================================

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number[];
  opened_at: Date | null;
  half_open_successes: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private config: NeverhangConfig;
  private db: Database.Database;

  constructor(config: NeverhangConfig, db: Database.Database) {
    this.config = config;
    this.db = db;

    // Load state from A.L.A.N. database
    const saved = loadCircuitState(db);
    this.state = this.hydrateState(saved);
  }

  private hydrateState(saved: CircuitStateRow): CircuitBreakerState {
    // Check if circuit was open and cooldown has passed
    if (saved.state === "open" && saved.opened_at) {
      const elapsed = Date.now() - saved.opened_at;
      if (elapsed >= this.config.circuit_open_duration_ms) {
        console.error("[neverhang] Circuit: was open, cooldown passed -> half_open");
        return {
          state: "half_open",
          failures: [],
          opened_at: null,
          half_open_successes: 0,
        };
      }
    }

    return {
      state: saved.state as CircuitState,
      failures: [], // Will rebuild from recent failures
      opened_at: saved.opened_at ? new Date(saved.opened_at) : null,
      half_open_successes: saved.recovery_successes,
    };
  }

  private persist(): void {
    saveCircuitState(this.db, {
      state: this.state.state,
      failure_count: this.state.failures.length,
      last_failure_at: this.state.failures.length > 0
        ? this.state.failures[this.state.failures.length - 1]
        : null,
      opened_at: this.state.opened_at?.getTime() ?? null,
      recovery_successes: this.state.half_open_successes,
    });
  }

  canExecute(): boolean {
    this.cleanOldFailures();

    switch (this.state.state) {
      case "closed":
        return true;

      case "open":
        // Check if it's time to try half-open
        if (this.state.opened_at) {
          const elapsed = Date.now() - this.state.opened_at.getTime();
          if (elapsed >= this.config.circuit_open_duration_ms) {
            this.state.state = "half_open";
            this.state.half_open_successes = 0;
            this.persist();
            console.error("[neverhang] Circuit: open -> half_open (testing)");
            return true;
          }
        }
        return false;

      case "half_open":
        return true;
    }
  }

  recordSuccess(): void {
    if (this.state.state === "half_open") {
      this.state.half_open_successes++;
      if (this.state.half_open_successes >= this.config.circuit_recovery_threshold) {
        this.state.state = "closed";
        this.state.failures = [];
        this.state.opened_at = null;
        this.persist();
        console.error("[neverhang] Circuit: half_open -> closed (recovered)");
      } else {
        this.persist();
      }
    }
  }

  recordFailure(excludeFromCircuit: boolean = false): void {
    if (excludeFromCircuit) return;

    this.state.failures.push(Date.now());
    this.cleanOldFailures();

    if (this.state.state === "half_open") {
      // Any failure in half-open reopens the circuit
      this.state.state = "open";
      this.state.opened_at = new Date();
      this.persist();
      console.error("[neverhang] Circuit: half_open -> open (test failed)");
      return;
    }

    if (this.state.state === "closed") {
      if (this.state.failures.length >= this.config.circuit_failure_threshold) {
        this.state.state = "open";
        this.state.opened_at = new Date();
        this.persist();
        console.error(
          `[neverhang] Circuit: closed -> open (${this.state.failures.length} failures)`
        );
      }
    }
  }

  private cleanOldFailures(): void {
    const cutoff = Date.now() - this.config.circuit_failure_window_ms;
    this.state.failures = this.state.failures.filter((t) => t > cutoff);
  }

  getState(): CircuitState {
    this.cleanOldFailures();
    return this.state.state;
  }

  getOpenDuration(): number | null {
    if (this.state.state !== "open" || !this.state.opened_at) return null;
    return Date.now() - this.state.opened_at.getTime();
  }

  getTimeUntilHalfOpen(): number | null {
    if (this.state.state !== "open" || !this.state.opened_at) return null;
    const elapsed = Date.now() - this.state.opened_at.getTime();
    const remaining = this.config.circuit_open_duration_ms - elapsed;
    return Math.max(0, remaining);
  }

  getRecentFailures(): number {
    this.cleanOldFailures();
    return this.state.failures.length;
  }
}

// ============================================================================
// COMMAND CLASSIFICATION
// ============================================================================

const TOOL_CATEGORIES: Record<string, CommandCategory> = {
  // Status (fast)
  systemd_list_units: "status",
  systemd_unit_status: "status",
  systemd_failed_units: "status",
  systemd_timers: "status",

  // Query (medium)
  systemd_journal_query: "query",
  systemd_journal_tail: "query",
  systemd_dependencies: "query",
  systemd_cat_unit: "query",
  systemd_unit_resources: "query",
  systemd_sample_resources: "query",
  systemd_boot_log: "query",

  // Action (slow, mutating)
  systemd_start: "action",
  systemd_stop: "action",
  systemd_restart: "action",
  systemd_reload: "action",
  systemd_enable: "action",
  systemd_disable: "action",

  // Heavy (very slow)
  systemd_daemon_reload: "heavy",

  // Diagnostic (involves AI)
  systemd_diagnose: "diagnostic",
  systemd_analyze_boot: "diagnostic",
};

export function classifyCommand(toolName: string): CommandCategory {
  return TOOL_CATEGORIES[toolName] || "query";
}

// ============================================================================
// ADAPTIVE TIMEOUT
// ============================================================================

export class AdaptiveTimeout {
  private config: NeverhangConfig;
  private db: Database.Database;

  constructor(config: NeverhangConfig, db: Database.Database) {
    this.config = config;
    this.db = db;
  }

  private getBaseTimeout(category: CommandCategory): number {
    switch (category) {
      case "status":
        return this.config.status_timeout_ms;
      case "query":
        return this.config.query_timeout_ms;
      case "action":
        return this.config.action_timeout_ms;
      case "heavy":
        return this.config.heavy_timeout_ms;
      case "diagnostic":
        return this.config.diagnostic_timeout_ms;
    }
  }

  getTimeout(
    category: CommandCategory,
    healthStatus: HealthStatus,
    userOverride?: number
  ): { timeout_ms: number; reason: string } {
    // User override takes precedence
    if (userOverride !== undefined) {
      return { timeout_ms: userOverride, reason: "user override" };
    }

    let baseTimeout = this.getBaseTimeout(category);
    const reasons: string[] = [`${category} base: ${baseTimeout}ms`];

    // Learn from A.L.A.N. if adaptive enabled
    if (this.config.adaptive_timeout) {
      const p95 = getP95Latency(this.db, category);
      if (p95 !== null) {
        // Use P95 + 50% buffer, but don't go below base
        const learned = Math.round(p95 * 1.5);
        if (learned > baseTimeout) {
          baseTimeout = learned;
          reasons.push(`learned P95+50%: ${learned}ms`);
        }
      }
    }

    // Health multiplier
    let multiplier = 1.0;
    switch (healthStatus) {
      case "healthy":
        // No change
        break;
      case "degraded":
        multiplier = 0.5; // Fail fast
        reasons.push("degraded (0.5x)");
        break;
      case "unhealthy":
        // Should be blocked by circuit breaker
        multiplier = 0.25;
        reasons.push("unhealthy (0.25x)");
        break;
    }

    const finalTimeout = Math.round(baseTimeout * multiplier);
    return {
      timeout_ms: finalTimeout,
      reason: reasons.join(", "),
    };
  }
}

// ============================================================================
// NEVERHANG MANAGER (Unified Interface)
// ============================================================================

export interface NeverhangStats {
  status: HealthStatus;
  circuit: CircuitState;
  circuit_opens_in: number | null;
  latency_ms: number;
  latency_p95_ms: number;
  recent_failures: number;
  last_success: Date | null;
  last_failure: Date | null;
}

export class NeverhangManager {
  readonly config: NeverhangConfig;
  readonly health: HealthMonitor;
  readonly circuit: CircuitBreaker;
  readonly timeout: AdaptiveTimeout;
  private db: Database.Database;

  private startTime: Date;
  private totalCommands: number = 0;
  private successfulCommands: number = 0;

  constructor(
    config: Partial<NeverhangConfig>,
    db: Database.Database,
    pingFn: () => Promise<void>
  ) {
    this.config = { ...DEFAULT_NEVERHANG_CONFIG, ...config };
    this.db = db;
    this.health = new HealthMonitor(this.config, db, pingFn);
    this.circuit = new CircuitBreaker(this.config, db);
    this.timeout = new AdaptiveTimeout(this.config, db);
    this.startTime = new Date();
  }

  start(): void {
    this.health.startBackgroundCheck();
  }

  stop(): void {
    this.health.stopBackgroundCheck();
  }

  canExecute(): { allowed: boolean; reason?: string } {
    if (!this.circuit.canExecute()) {
      const timeLeft = this.circuit.getTimeUntilHalfOpen();
      return {
        allowed: false,
        reason: `Circuit open. Retry in ${Math.ceil((timeLeft || 0) / 1000)}s`,
      };
    }
    return { allowed: true };
  }

  getTimeout(
    category: CommandCategory,
    userOverride?: number
  ): { timeout_ms: number; reason: string } {
    const healthState = this.health.getHealth();
    return this.timeout.getTimeout(category, healthState.status, userOverride);
  }

  recordSuccess(toolName: string, category: CommandCategory, duration_ms: number): void {
    this.totalCommands++;
    this.successfulCommands++;
    this.circuit.recordSuccess();

    // Log to A.L.A.N. database
    recordCommand(this.db, toolName, category, duration_ms, true);
  }

  recordFailure(
    toolName: string,
    category: CommandCategory,
    duration_ms: number,
    errorType: FailureType
  ): void {
    this.totalCommands++;
    // Diagnostic commands don't affect circuit (they involve external AI calls)
    const excludeFromCircuit = category === "diagnostic";
    this.circuit.recordFailure(excludeFromCircuit);

    // Log to A.L.A.N. database
    recordCommand(this.db, toolName, category, duration_ms, false, errorType);
  }

  getStats(): NeverhangStats {
    const healthState = this.health.getHealth();
    return {
      status: healthState.status,
      circuit: this.circuit.getState(),
      circuit_opens_in: this.circuit.getTimeUntilHalfOpen(),
      latency_ms: healthState.latency_ms,
      latency_p95_ms: this.health.getLatencyP95(),
      recent_failures: this.circuit.getRecentFailures(),
      last_success: healthState.last_success,
      last_failure: healthState.last_failure,
    };
  }

  getDatabaseStats(): DatabaseStats {
    return getDatabaseStats(this.db);
  }

  getUptimePercent(): number {
    if (this.totalCommands === 0) return 100;
    return Math.round((this.successfulCommands / this.totalCommands) * 100);
  }

  getSuccessRate(): number {
    return getRecentSuccessRate(this.db);
  }
}
