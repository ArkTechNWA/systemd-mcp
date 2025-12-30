/**
 * Configuration management for systemd-mcp
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Config {
  permissions: {
    read: boolean;
    restart: boolean;
    start_stop: boolean;
    enable_disable: boolean;
    daemon_reload: boolean;
    whitelist: string[];
    blacklist: string[];
  };
  neverhang: {
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
  };
  fallback: {
    enabled: boolean;
    model?: string;
    api_key_env?: string;
    max_context_lines?: number;
    max_tokens?: number;
  };
  ssh: {
    enabled: boolean;
    host?: string;  // SSH host alias or user@host
  };
}

const DEFAULT_BLACKLIST = [
  "sshd.service",
  "firewalld.service",
  "iptables.service",
  "nftables.service",
  "systemd-*.service",
  "dbus.service",
  "polkit.service",
];

const DEFAULT_CONFIG: Config = {
  permissions: {
    read: true,
    restart: false,
    start_stop: false,
    enable_disable: false,
    daemon_reload: false,
    whitelist: [],
    blacklist: DEFAULT_BLACKLIST,
  },
  neverhang: {
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
  },
  fallback: {
    enabled: false,
  },
  ssh: {
    enabled: false,
  },
};

export function loadConfig(): Config {
  // Check for bypass mode
  if (process.env.SYSTEMD_MCP_BYPASS === "1" || process.argv.includes("--bypass-permissions")) {
    console.error("[systemd-mcp] BYPASS MODE ENABLED - all permissions granted");
    return {
      ...DEFAULT_CONFIG,
      permissions: {
        read: true,
        restart: true,
        start_stop: true,
        enable_disable: true,
        daemon_reload: true,
        whitelist: [],
        blacklist: [], // No blacklist in bypass mode
      },
    };
  }

  // Try to load config file
  const configPaths = [
    process.env.SYSTEMD_MCP_CONFIG,
    join(homedir(), ".config", "systemd-mcp", "config.json"),
    join(process.cwd(), "config.json"),
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        console.error(`[systemd-mcp] Loaded config from ${configPath}`);
        return mergeConfig(DEFAULT_CONFIG, fileConfig);
      } catch (error) {
        console.error(`[systemd-mcp] Error loading ${configPath}:`, error);
      }
    }
  }

  // Apply environment variable overrides
  const config = { ...DEFAULT_CONFIG };

  if (process.env.SYSTEMD_MCP_ALLOW_RESTART === "1") {
    config.permissions.restart = true;
  }
  if (process.env.SYSTEMD_MCP_ALLOW_START_STOP === "1") {
    config.permissions.start_stop = true;
  }
  if (process.env.SYSTEMD_MCP_ALLOW_ENABLE_DISABLE === "1") {
    config.permissions.enable_disable = true;
  }
  if (process.env.SYSTEMD_MCP_ALLOW_DAEMON_RELOAD === "1") {
    config.permissions.daemon_reload = true;
  }

  // SSH host override
  if (process.env.SYSTEMD_MCP_SSH_HOST) {
    config.ssh = {
      enabled: true,
      host: process.env.SYSTEMD_MCP_SSH_HOST,
    };
  }

  console.error("[systemd-mcp] Using default config");
  return config;
}

function mergeConfig(defaults: Config, overrides: Partial<Config>): Config {
  return {
    permissions: {
      ...defaults.permissions,
      ...overrides.permissions,
      // Ensure blacklist always includes defaults unless explicitly overridden
      blacklist: overrides.permissions?.blacklist ?? [
        ...defaults.permissions.blacklist,
        ...(overrides.permissions?.blacklist || []),
      ],
    },
    neverhang: {
      ...defaults.neverhang,
      ...overrides.neverhang,
    },
    fallback: {
      ...defaults.fallback,
      ...overrides.fallback,
    },
    ssh: {
      ...defaults.ssh,
      ...overrides.ssh,
    },
  };
}
