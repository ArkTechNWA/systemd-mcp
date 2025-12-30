#!/usr/bin/env node
/**
 * systemd-mcp
 * MCP server for systemd integration
 *
 * @author Claude + MOD
 * @license MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { loadConfig, type Config } from "./config.js";
import { checkPermission, checkUnitAccess } from "./permissions.js";
import { withTimeout, parseSystemctlShow, formatUptime } from "./utils.js";
import { isHaikuEnabled, diagnoseWithHaiku } from "./haiku.js";

const execAsync = promisify(exec);

// ============================================================================
// INITIALIZATION
// ============================================================================

const config = loadConfig();

const server = new McpServer({
  name: "systemd-mcp",
  version: "0.4.0",
});

// ============================================================================
// HELPER: Execute systemd commands (local or via SSH)
// ============================================================================

interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a command locally or via SSH depending on config.
 * When SSH is enabled, commands are wrapped with: ssh <host> "<escaped_cmd>"
 */
async function runCommand(
  cmd: string,
  timeoutMs: number = config.neverhang.query_timeout
): Promise<ExecResult> {
  let actualCmd = cmd;

  if (config.ssh.enabled && config.ssh.host) {
    // Escape single quotes for SSH: replace ' with '\''
    const escapedCmd = cmd.replace(/'/g, "'\\''");
    actualCmd = `ssh ${config.ssh.host} '${escapedCmd}'`;
  }

  return withTimeout(
    execAsync(actualCmd, { maxBuffer: 10 * 1024 * 1024 }),
    timeoutMs
  );
}

// ============================================================================
// TOOLS: Status & Discovery
// ============================================================================

server.tool(
  "systemd_list_units",
  "List systemd units with optional filtering",
  {
    type: z
      .enum(["service", "timer", "socket", "mount", "target", "all"])
      .optional()
      .describe("Unit type filter"),
    state: z
      .enum(["running", "failed", "inactive", "activating", "all"])
      .optional()
      .describe("Unit state filter"),
    pattern: z.string().optional().describe("Glob pattern to match unit names"),
  },
  async ({ type, state, pattern }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    let cmd = "systemctl list-units --no-pager --no-legend";
    if (type && type !== "all") cmd += ` --type=${type}`;
    if (state && state !== "all") cmd += ` --state=${state}`;
    if (pattern) cmd += ` '${pattern}'`;

    try {
      const { stdout } = await runCommand(cmd);
      const lines = stdout.trim().split("\n").filter(Boolean);

      const units = lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          unit: parts[0],
          load: parts[1],
          active: parts[2],
          sub: parts[3],
          description: parts.slice(4).join(" "),
        };
      });

      const running = units.filter((u) => u.sub === "running").length;
      const failed = units.filter((u) => u.active === "failed").length;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                units,
                summary: `${units.length} units (${running} running, ${failed} failed)`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_unit_status",
  "Get detailed status of one or more units",
  {
    units: z
      .union([z.string(), z.array(z.string())])
      .describe("Unit name(s) - e.g., 'nginx.service' or ['nginx', 'postgres']"),
    logs: z.number().optional().describe("Include N recent log lines (default: 10)"),
  },
  async ({ units, logs = 10 }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, error: "Unit is blacklisted" });
        continue;
      }

      try {
        // Get status
        const { stdout: showOutput } = await runCommand(
          `systemctl show ${unitName} --no-pager`
        );
        const props = parseSystemctlShow(showOutput);

        // Get recent logs
        let recentLogs: string[] = [];
        if (logs > 0) {
          try {
            const { stdout: logOutput } = await runCommand(
              `journalctl -u ${unitName} -n ${logs} --no-pager --output=short`
            );
            recentLogs = logOutput.trim().split("\n").filter(Boolean);
          } catch {
            // Logs may not exist
          }
        }

        const activeState = props.ActiveState || "unknown";
        const subState = props.SubState || "unknown";

        results.push({
          unit: unitName,
          status: activeState,
          sub_state: subState,
          status_icon: activeState === "active" ? "✓" : activeState === "failed" ? "✗" : "○",
          pid: props.MainPID !== "0" ? parseInt(props.MainPID) : null,
          memory: props.MemoryCurrent ? `${Math.round(parseInt(props.MemoryCurrent) / 1024 / 1024)}M` : null,
          uptime: props.ActiveEnterTimestamp ? formatUptime(props.ActiveEnterTimestamp) : null,
          started_at: props.ActiveEnterTimestamp || null,
          enabled: props.UnitFileState === "enabled",
          recent_logs: recentLogs,
        });
      } catch (error) {
        results.push({
          unit: unitName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "systemd_failed_units",
  "Quick view of failed units",
  {},
  async () => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    try {
      const { stdout } = await runCommand(
        "systemctl list-units --state=failed --no-pager --no-legend"
      );
      const lines = stdout.trim().split("\n").filter(Boolean);

      const units = await Promise.all(
        lines.map(async (line) => {
          const parts = line.trim().split(/\s+/);
          // First part is ● status marker, second is unit name
          const unit = parts[0] === "●" ? parts[1] : parts[0];

          // Get last log line
          let lastLog = "";
          try {
            const { stdout: logOutput } = await runCommand(
              `journalctl -u ${unit} -n 1 --no-pager -o cat`
            );
            lastLog = logOutput.trim();
          } catch {
            // Ignore
          }

          // Description starts after: ● unit loaded failed failed
          const descStart = parts[0] === "●" ? 5 : 4;
          return {
            unit,
            description: parts.slice(descStart).join(" "),
            last_log: lastLog,
          };
        })
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                failed_count: units.length,
                units,
                summary:
                  units.length === 0
                    ? "No failed units"
                    : `${units.length} failed: ${units.map((u) => u.unit).join(", ")}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_timers",
  "List active timers with schedule info",
  {
    pattern: z.string().optional().describe("Filter by pattern"),
  },
  async ({ pattern }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    try {
      const { stdout } = await runCommand(
        "systemctl list-timers --no-pager --no-legend"
      );
      const lines = stdout.trim().split("\n").filter(Boolean);

      const timers = lines
        .map((line) => {
          // Format: NEXT (datetime) LEFT LAST (datetime) PASSED UNIT ACTIVATES
          // Find .timer and .service by regex since column widths vary
          const timerMatch = line.match(/(\S+\.timer)\s+(\S+\.service)/);
          if (!timerMatch) return null;

          const timer = timerMatch[1];
          const service = timerMatch[2];

          // Extract NEXT datetime (first 4 tokens: Day YYYY-MM-DD HH:MM:SS TZ)
          const parts = line.trim().split(/\s+/);
          const nextRun = parts.slice(0, 4).join(" ");

          // Find LAST datetime - look for pattern after LEFT column
          // LAST appears after a variable-width LEFT column
          const lastMatch = line.match(/\s(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\w+)/);
          const lastRun = lastMatch ? `${lastMatch[1]} ${lastMatch[2]}` : "n/a";

          return { timer, service, next_run: nextRun, last_run: lastRun };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .filter((t) => !pattern || t.timer.includes(pattern));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ timers, count: timers.length }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_dependencies",
  "Show unit dependency tree",
  {
    unit: z.string().describe("Unit name"),
    direction: z
      .enum(["requires", "wanted_by", "both"])
      .optional()
      .describe("Dependency direction"),
  },
  async ({ unit, direction = "both" }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    try {
      const result: Record<string, string[]> = {};

      if (direction === "requires" || direction === "both") {
        const { stdout } = await runCommand(
          `systemctl list-dependencies ${unitName} --no-pager`
        );
        result.requires = stdout.trim().split("\n").slice(1); // Skip header
      }

      if (direction === "wanted_by" || direction === "both") {
        const { stdout } = await runCommand(
          `systemctl list-dependencies ${unitName} --reverse --no-pager`
        );
        result.wanted_by = stdout.trim().split("\n").slice(1);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ unit: unitName, ...result }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_cat_unit",
  "View unit file contents (systemctl cat)",
  {
    unit: z.string().describe("Unit name to view"),
  },
  async ({ unit }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    if (!checkUnitAccess(config, unitName)) {
      return { content: [{ type: "text", text: `Permission denied: ${unitName} is blacklisted` }] };
    }

    try {
      const { stdout } = await runCommand(`systemctl cat ${unitName} --no-pager`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                unit: unitName,
                content: stdout.trim(),
                lines: stdout.trim().split("\n").length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

// ============================================================================
// TOOLS: Resource Monitoring (v0.4.0)
// ============================================================================

const RESOURCE_PROPERTIES = [
  "MemoryCurrent",
  "MemoryPeak",
  "CPUUsageNSec",
  "TasksCurrent",
  "IPIngressBytes",
  "IPEgressBytes",
  "IOReadBytes",
  "IOWriteBytes",
];

function formatBytes(bytes: number): string {
  // Handle edge cases
  if (bytes === 0) return "0 B";
  if (isNaN(bytes) || bytes < 0) return "N/A";
  // Max uint64 (18446744073709551615) indicates uninitialized/not tracked
  if (bytes > 1e18) return "N/A";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatNanoseconds(ns: number): string {
  if (ns < 1000) return `${ns}ns`;
  if (ns < 1000000) return `${(ns / 1000).toFixed(1)}µs`;
  if (ns < 1000000000) return `${(ns / 1000000).toFixed(1)}ms`;
  return `${(ns / 1000000000).toFixed(2)}s`;
}

async function getUnitResources(unitName: string): Promise<Record<string, number>> {
  const props = RESOURCE_PROPERTIES.join(",");
  const { stdout } = await runCommand(
    `systemctl show ${unitName} --property=${props}`
  );

  const result: Record<string, number> = {};
  for (const line of stdout.trim().split("\n")) {
    const [key, value] = line.split("=");
    if (key && value) {
      // Handle [not set] or empty values
      const numValue = value === "[not set]" || value === "" ? 0 : parseInt(value, 10);
      result[key] = isNaN(numValue) ? 0 : numValue;
    }
  }
  return result;
}

server.tool(
  "systemd_unit_resources",
  "Get current resource usage for a unit (memory, CPU, tasks, I/O)",
  {
    unit: z.string().describe("Unit name"),
  },
  async ({ unit }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    if (!checkUnitAccess(config, unitName)) {
      return { content: [{ type: "text", text: `Permission denied: ${unitName} is blacklisted` }] };
    }

    try {
      const resources = await getUnitResources(unitName);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                unit: unitName,
                memory: {
                  current: resources.MemoryCurrent,
                  current_human: formatBytes(resources.MemoryCurrent),
                  peak: resources.MemoryPeak,
                  peak_human: formatBytes(resources.MemoryPeak),
                },
                cpu: {
                  total_ns: resources.CPUUsageNSec,
                  total_human: formatNanoseconds(resources.CPUUsageNSec),
                },
                tasks: resources.TasksCurrent,
                network: {
                  ingress: resources.IPIngressBytes,
                  ingress_human: formatBytes(resources.IPIngressBytes),
                  egress: resources.IPEgressBytes,
                  egress_human: formatBytes(resources.IPEgressBytes),
                },
                io: {
                  read: resources.IOReadBytes,
                  read_human: formatBytes(resources.IOReadBytes),
                  write: resources.IOWriteBytes,
                  write_human: formatBytes(resources.IOWriteBytes),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_sample_resources",
  "Sample resource usage over time and calculate trends",
  {
    unit: z.string().describe("Unit name"),
    samples: z.number().min(2).max(10).default(5).describe("Number of samples (2-10)"),
    interval_ms: z.number().min(100).max(5000).default(1000).describe("Interval between samples in ms"),
  },
  async ({ unit, samples = 5, interval_ms = 1000 }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    if (!checkUnitAccess(config, unitName)) {
      return { content: [{ type: "text", text: `Permission denied: ${unitName} is blacklisted` }] };
    }

    try {
      const readings: Array<Record<string, number>> = [];

      // Collect samples
      for (let i = 0; i < samples; i++) {
        readings.push(await getUnitResources(unitName));
        if (i < samples - 1) {
          await new Promise((resolve) => setTimeout(resolve, interval_ms));
        }
      }

      const first = readings[0];
      const last = readings[readings.length - 1];
      const duration_ms = (samples - 1) * interval_ms;
      const duration_s = duration_ms / 1000;

      // Calculate deltas and rates
      const cpuDelta = last.CPUUsageNSec - first.CPUUsageNSec;
      const cpuPercent = (cpuDelta / (duration_ms * 1000000)) * 100; // ns to ms ratio

      const memoryReadings = readings.map((r) => r.MemoryCurrent);
      const memoryMin = Math.min(...memoryReadings);
      const memoryMax = Math.max(...memoryReadings);
      const memoryAvg = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;

      const ioReadRate = (last.IOReadBytes - first.IOReadBytes) / duration_s;
      const ioWriteRate = (last.IOWriteBytes - first.IOWriteBytes) / duration_s;
      const netInRate = (last.IPIngressBytes - first.IPIngressBytes) / duration_s;
      const netOutRate = (last.IPEgressBytes - first.IPEgressBytes) / duration_s;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                unit: unitName,
                sampling: {
                  samples,
                  interval_ms,
                  duration_ms,
                },
                cpu: {
                  delta_ns: cpuDelta,
                  percent: parseFloat(cpuPercent.toFixed(2)),
                },
                memory: {
                  min: memoryMin,
                  min_human: formatBytes(memoryMin),
                  max: memoryMax,
                  max_human: formatBytes(memoryMax),
                  avg: Math.round(memoryAvg),
                  avg_human: formatBytes(memoryAvg),
                  stable: memoryMax - memoryMin < memoryAvg * 0.05,
                },
                io: {
                  read_rate: Math.round(ioReadRate),
                  read_rate_human: `${formatBytes(ioReadRate)}/s`,
                  write_rate: Math.round(ioWriteRate),
                  write_rate_human: `${formatBytes(ioWriteRate)}/s`,
                },
                network: {
                  ingress_rate: Math.round(netInRate),
                  ingress_rate_human: `${formatBytes(netInRate)}/s`,
                  egress_rate: Math.round(netOutRate),
                  egress_rate_human: `${formatBytes(netOutRate)}/s`,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

// ============================================================================
// TOOLS: Journal/Logs
// ============================================================================

server.tool(
  "systemd_journal_query",
  "Query journal with filters",
  {
    unit: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("Unit(s) to filter by"),
    since: z.string().optional().describe("Start time - e.g., '-1h', '-30m', '2025-12-29'"),
    until: z.string().optional().describe("End time"),
    priority: z
      .enum(["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"])
      .optional()
      .describe("Minimum priority level"),
    grep: z.string().optional().describe("Filter log content"),
    limit: z.number().optional().describe("Max lines (default: 100)"),
  },
  async ({ unit, since, until, priority, grep, limit = 100 }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    let cmd = `journalctl --no-pager -n ${limit}`;

    if (unit) {
      const units = Array.isArray(unit) ? unit : [unit];
      units.forEach((u) => {
        const unitName = u.includes(".") ? u : `${u}.service`;
        cmd += ` -u ${unitName}`;
      });
    }

    if (since) cmd += ` --since="${since}"`;
    if (until) cmd += ` --until="${until}"`;
    if (priority) cmd += ` -p ${priority}`;
    if (grep) cmd += ` --grep="${grep}"`;

    try {
      const { stdout } = await runCommand(cmd);
      const lines = stdout.trim().split("\n");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ lines, count: lines.length }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_journal_tail",
  "Get recent logs (live tail not supported in MCP)",
  {
    unit: z.string().describe("Unit to tail"),
    lines: z.number().optional().describe("Number of lines (default: 50)"),
  },
  async ({ unit, lines = 50 }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    if (!checkUnitAccess(config, unitName)) {
      return { content: [{ type: "text", text: `Permission denied: ${unitName} is blacklisted` }] };
    }

    try {
      const { stdout } = await runCommand(
        `journalctl -u ${unitName} -n ${lines} --no-pager`
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                unit: unitName,
                lines: stdout.trim().split("\n"),
                note: "Live tail (follow) not supported - call again for updates",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_boot_log",
  "Important events from current boot",
  {
    priority: z
      .enum(["err", "warning", "notice"])
      .optional()
      .describe("Minimum priority (default: err)"),
    limit: z.number().optional().describe("Max lines (default: 50)"),
  },
  async ({ priority = "err", limit = 50 }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    try {
      const { stdout } = await runCommand(
        `journalctl -b -p ${priority} -n ${limit} --no-pager`
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                boot: "current",
                priority,
                lines: stdout.trim().split("\n"),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

// ============================================================================
// TOOLS: Actions
// ============================================================================

server.tool(
  "systemd_start",
  "Start unit(s) - requires start_stop permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to start"),
  },
  async ({ units }) => {
    if (!checkPermission(config, "start_stop")) {
      return { content: [{ type: "text", text: "Permission denied: start_stop not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        await runCommand(`systemctl start ${unitName}`, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: "started" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_stop",
  "Stop unit(s) - requires start_stop permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to stop"),
  },
  async ({ units }) => {
    if (!checkPermission(config, "start_stop")) {
      return { content: [{ type: "text", text: "Permission denied: start_stop not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        await runCommand(`systemctl stop ${unitName}`, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: "stopped" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_restart",
  "Restart unit(s) - requires restart permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to restart"),
  },
  async ({ units }) => {
    if (!checkPermission(config, "restart")) {
      return { content: [{ type: "text", text: "Permission denied: restart not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        await runCommand(`systemctl restart ${unitName}`, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: "restarted" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_reload",
  "Reload unit configuration (SIGHUP) - requires restart permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to reload"),
  },
  async ({ units }) => {
    if (!checkPermission(config, "restart")) {
      return { content: [{ type: "text", text: "Permission denied: restart not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        await runCommand(`systemctl reload ${unitName}`, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: "reloaded" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_enable",
  "Enable unit for boot - requires enable_disable permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to enable"),
    now: z.boolean().optional().describe("Also start the unit now"),
  },
  async ({ units, now = false }) => {
    if (!checkPermission(config, "enable_disable")) {
      return { content: [{ type: "text", text: "Permission denied: enable_disable not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        const cmd = now ? `systemctl enable --now ${unitName}` : `systemctl enable ${unitName}`;
        await runCommand(cmd, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: now ? "enabled+started" : "enabled" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_disable",
  "Disable unit from boot - requires enable_disable permission",
  {
    units: z.union([z.string(), z.array(z.string())]).describe("Unit(s) to disable"),
    now: z.boolean().optional().describe("Also stop the unit now"),
  },
  async ({ units, now = false }) => {
    if (!checkPermission(config, "enable_disable")) {
      return { content: [{ type: "text", text: "Permission denied: enable_disable not enabled" }] };
    }

    const unitList = Array.isArray(units) ? units : [units];
    const results = [];

    for (const unit of unitList) {
      const unitName = unit.includes(".") ? unit : `${unit}.service`;

      if (!checkUnitAccess(config, unitName)) {
        results.push({ unit: unitName, success: false, error: "Unit is blacklisted" });
        continue;
      }

      try {
        const cmd = now ? `systemctl disable --now ${unitName}` : `systemctl disable ${unitName}`;
        await runCommand(cmd, config.neverhang.action_timeout);
        results.push({ unit: unitName, success: true, action: now ? "disabled+stopped" : "disabled" });
      } catch (error) {
        results.push({
          unit: unitName,
          success: false,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "systemd_daemon_reload",
  "Reload systemd manager - requires daemon_reload permission",
  {},
  async () => {
    if (!checkPermission(config, "daemon_reload")) {
      return { content: [{ type: "text", text: "Permission denied: daemon_reload not enabled" }] };
    }

    try {
      await runCommand("systemctl daemon-reload", config.neverhang.action_timeout);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, action: "daemon-reload" }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

// ============================================================================
// TOOLS: Analysis
// ============================================================================

server.tool(
  "systemd_analyze_boot",
  "Boot time analysis",
  {
    blame: z.boolean().optional().describe("Show time per unit"),
    critical_chain: z.boolean().optional().describe("Show critical chain"),
  },
  async ({ blame = false, critical_chain = false }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    try {
      const result: Record<string, unknown> = {};

      // Basic boot time
      const { stdout: timeOutput } = await runCommand("systemd-analyze time");
      result.boot_time = timeOutput.trim();

      if (blame) {
        const { stdout: blameOutput } = await runCommand("systemd-analyze blame --no-pager | head -20");
        result.blame = blameOutput.trim().split("\n");
      }

      if (critical_chain) {
        const { stdout: chainOutput } = await runCommand("systemd-analyze critical-chain --no-pager");
        result.critical_chain = chainOutput.trim().split("\n");
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

server.tool(
  "systemd_diagnose",
  "AI-powered failure diagnosis",
  {
    unit: z.string().describe("Unit to diagnose"),
    use_ai: z.boolean().optional().describe("Use Haiku AI for synthesis"),
  },
  async ({ unit, use_ai = true }) => {
    if (!checkPermission(config, "read")) {
      return { content: [{ type: "text", text: "Permission denied: read access not enabled" }] };
    }

    const unitName = unit.includes(".") ? unit : `${unit}.service`;

    try {
      // Gather context
      const { stdout: showOutput } = await runCommand(`systemctl show ${unitName} --no-pager`);
      const props = parseSystemctlShow(showOutput);

      const { stdout: logOutput } = await runCommand(
        `journalctl -u ${unitName} -n 50 --no-pager -o short`
      );

      const context = {
        unit: unitName,
        status: props.ActiveState,
        sub_state: props.SubState,
        exit_code: props.ExecMainStatus,
        result: props.Result,
        logs: logOutput.trim(),
      };

      // AI synthesis if enabled and available
      let synthesis = null;
      if (use_ai && isHaikuEnabled(config)) {
        synthesis = await diagnoseWithHaiku(config, {
          unit: unitName,
          status: props.ActiveState || "unknown",
          exit_code: props.ExecMainStatus || "unknown",
          logs: logOutput,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...context,
                synthesis: synthesis || {
                  note: "AI synthesis not available - check logs above",
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Unknown"}` }],
      };
    }
  }
);

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[systemd-mcp] Running on stdio");
  console.error(`[systemd-mcp] Permissions: read=${config.permissions.read}, restart=${config.permissions.restart}, start_stop=${config.permissions.start_stop}`);
  if (config.ssh.enabled && config.ssh.host) {
    console.error(`[systemd-mcp] SSH mode: ${config.ssh.host}`);
  } else {
    console.error("[systemd-mcp] Mode: local");
  }
}

main().catch((error) => {
  console.error("[systemd-mcp] Fatal error:", error);
  process.exit(1);
});
