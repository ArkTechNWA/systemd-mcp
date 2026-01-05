<img align="right" src="logo.jpg" width="150">

<br><br><br>

# systemd-mcp

[![CI](https://github.com/ArkTechNWA/systemd-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ArkTechNWA/systemd-mcp/actions/workflows/ci.yml)

A Model Context Protocol (MCP) server for systemd integration. Give your AI assistant eyes and hands on your Linux services.

**Status:** v0.5.0 (NEVERHANG v2.0)

**Author:** Claude + MOD

**License:** MIT

**Organization:** [ArktechNWA](https://github.com/ArktechNWA)

---

## Why?

AI assistants are blind to your system. They can write code but can't see if nginx crashed, can't tail logs, can't restart a stuck daemon.

"Just give it shell access" — bad idea. Shell access is all-or-nothing. One hallucinated `rm -rf` or hung `systemctl` and you're in trouble. No guardrails, no visibility, no recovery.

systemd-mcp is **an intelligent interface**, not a wrapper:

| Problem | systemd-mcp Solution |
|---------|---------------------|
| Commands can hang forever | NEVERHANG v2.0 — tiered timeouts, circuit breaker |
| No memory between calls | A.L.A.N. database — persistent state, learns your system |
| Failures cascade | Circuit breaker opens, commands fail fast, auto-recovery |
| AI has no operational intuition | Health trends, P95 latency, success rates — data it can reason about |
| All-or-nothing permissions | Granular: read-only default, whitelist/blacklist, permission tiers |

This is the difference between "run commands for me" and "understand my infrastructure."

---

## Philosophy

1. **Safety by default** — Read-only out of the box
2. **User controls exposure** — Whitelist, blacklist, permission levels
3. **NEVERHANG v2.0** — Circuit breaker, adaptive timeouts, A.L.A.N. database, self-healing
4. **Graceful fallback** — Optional Haiku AI for log analysis
5. **Structured output** — JSON for machines, summaries for AI

---

## Features

### Perception (Read)
- List all units with filtering (type, state, pattern)
- Detailed unit status with resource usage
- Failed units at a glance
- Timer schedules (last run, next run)
- Dependency trees
- Journal queries with filters (time, priority, grep)
- Live log streaming
- Boot analysis

### Action (Write)
- Start/stop/restart services
- Enable/disable boot behavior
- Reload configurations
- Daemon reload (after unit file changes)

### Analysis (Optional AI Fallback)
- "Why did this fail?" synthesis
- Boot time breakdown
- Complex log analysis

---

## Permission Model

Users are (rightfully) cautious about AI touching their systems. systemd-mcp provides granular control.

### Permission Levels

| Level | Description | Default |
|-------|-------------|---------|
| `read` | Status, logs, timers, dependencies | **ON** |
| `restart` | Restart already-running services | OFF |
| `start_stop` | Start stopped / stop running services | OFF |
| `enable_disable` | Modify boot behavior | OFF |
| `daemon_reload` | Reload systemd manager | OFF |

### Unit Filtering

```json
{
  "permissions": {
    "read": true,
    "restart": true,
    "start_stop": false,
    "enable_disable": false,
    "daemon_reload": false,

    "whitelist": [
      "myapp-*.service",
      "nginx.service",
      "postgresql.service"
    ],

    "blacklist": [
      "sshd.service",
      "firewalld.service",
      "systemd-*.service",
      "dbus.service"
    ]
  }
}
```

**Rules:**
- Blacklist always wins (even if whitelisted)
- Empty whitelist = all units allowed (subject to blacklist)
- Patterns support `*` wildcards
- System-critical units blacklisted by default

### Default Blacklist

These units are blocked by default (override with `--bypass-permissions`):

```
sshd.service          # Don't lock yourself out
firewalld.service     # Don't break the firewall
iptables.service      # Don't break the firewall
systemd-*.service     # Don't break systemd itself
dbus.service          # Don't break D-Bus
polkit.service        # Don't break permissions
```

### Bypass Mode

For power users who know what they're doing:

```bash
# Trust me, I know what I'm doing
systemd-mcp --bypass-permissions

# Or in config
{
  "bypass_permissions": true
}
```

**With bypass enabled:**
- All permission levels = true
- Whitelist/blacklist ignored
- Full systemd access
- You own the consequences

### Environment Variable Override

```bash
# Enable specific permissions via env
SYSTEMD_MCP_ALLOW_RESTART=1
SYSTEMD_MCP_ALLOW_START_STOP=1
SYSTEMD_MCP_BYPASS=1
```

---

## SSH Remote Host Support (v0.2.0)

Run systemd commands on a remote host via SSH instead of locally.

### Configuration

```bash
# Via environment variable
SYSTEMD_MCP_SSH_HOST=my-host node build/index.js

# Via config file (~/.config/systemd-mcp/config.json)
{
  "ssh": {
    "enabled": true,
    "host": "my-host"
  }
}
```

### Requirements

- SSH host must be accessible without password prompt (use SSH keys)
- SSH config alias (e.g., `my-host`) or full `user@host` format supported
- Remote host must have systemd and journalctl

### Claude Code Integration with SSH

```bash
# Monitor remote server
claude mcp add --transport stdio systemd-ssh -- \
  bash -c "SYSTEMD_MCP_SSH_HOST=my-server node /path/to/build/index.js"
```

---

## Multi-Instance Pattern (v0.3.0)

Run multiple instances to monitor both local and remote systems simultaneously.

### Setup

```bash
# Local instance (default)
claude mcp add --transport stdio systemd -s user -- \
  node /path/to/build/index.js

# Remote instance via SSH
claude mcp add --transport stdio systemd-ssh -s user -- \
  bash -c "SYSTEMD_MCP_SSH_HOST=my-server node /path/to/build/index.js"
```

### Result

Claude Code sees both as separate tool namespaces:

| MCP Name | Tools | Target |
|----------|-------|--------|
| `systemd` | `mcp__systemd__*` | Local machine |
| `systemd-ssh` | `mcp__systemd-ssh__*` | Remote via SSH |

Query both in parallel:

```
"Check nginx status on both local and remote"
→ mcp__systemd__systemd_unit_status({ units: "nginx" })
→ mcp__systemd-ssh__systemd_unit_status({ units: "nginx" })
```

Same codebase, multiple targets, unified visibility.

---

## Tools

### Status & Discovery

#### `systemd_list_units`
List units with optional filtering.

```typescript
systemd_list_units({
  type?: "service" | "timer" | "socket" | "mount" | "target" | "all",
  state?: "running" | "failed" | "inactive" | "activating" | "all",
  pattern?: string  // glob pattern, e.g. "nginx*"
})
```

#### `systemd_unit_status`
Detailed status of one or more units.

```typescript
systemd_unit_status({
  units: string | string[],  // "nginx.service" or ["nginx", "postgres"]
  logs?: number              // Include N recent log lines (default: 10)
})
```

Returns:
```json
{
  "unit": "nginx.service",
  "status": "running",
  "status_icon": "✓",
  "pid": 1234,
  "memory": "45.2M",
  "cpu": "0.1%",
  "uptime": "5d 12h 30m",
  "started_at": "2025-12-24T10:30:00Z",
  "recent_logs": ["..."],
  "summary": "nginx is healthy, running 5 days with stable memory"
}
```

#### `systemd_failed_units`
Quick view of what's broken.

```typescript
systemd_failed_units()
```

Returns:
```json
{
  "failed_count": 1,
  "units": [
    {
      "unit": "scout.service",
      "failed_at": "2025-12-29T04:00:12Z",
      "exit_code": 1,
      "last_log": "API key not found"
    }
  ],
  "summary": "1 failed unit: scout.service (API key not found)"
}
```

#### `systemd_timers`
Timer status overview.

```typescript
systemd_timers({
  pattern?: string  // filter by pattern
})
```

Returns:
```json
{
  "timers": [
    {
      "timer": "scout.timer",
      "service": "scout.service",
      "last_run": "2025-12-29T04:00:00Z",
      "next_run": "2025-12-30T04:00:00Z",
      "schedule": "*-*-* 04:00:00",
      "last_result": "success"
    }
  ]
}
```

#### `systemd_dependencies`
Show unit dependency tree.

```typescript
systemd_dependencies({
  unit: string,
  direction?: "requires" | "wanted_by" | "both"
})
```

#### `systemd_cat_unit`
View unit file contents (v0.3.0).

```typescript
systemd_cat_unit({
  unit: string  // e.g., "nginx" or "nginx.service"
})
```

Returns:
```json
{
  "unit": "nginx.service",
  "content": "# /usr/lib/systemd/system/nginx.service\n[Unit]\nDescription=...",
  "lines": 24
}
```

### Resource Monitoring (v0.4.0)

#### `systemd_unit_resources`
Get current resource usage snapshot.

```typescript
systemd_unit_resources({
  unit: string
})
```

Returns memory, CPU time, tasks, network I/O, disk I/O with human-readable formatting.

#### `systemd_sample_resources`
Sample resource usage over time and calculate trends.

```typescript
systemd_sample_resources({
  unit: string,
  samples?: number,      // 2-10, default: 5
  interval_ms?: number   // 100-5000, default: 1000
})
```

Returns:
```json
{
  "unit": "nginx.service",
  "sampling": { "samples": 5, "interval_ms": 1000, "duration_ms": 4000 },
  "cpu": { "delta_ns": 12500000, "percent": 0.31 },
  "memory": {
    "min": 45678592, "max": 46123008, "avg": 45900800,
    "stable": true
  },
  "io": { "read_rate_human": "1.2 KB/s", "write_rate_human": "0 B/s" },
  "network": { "ingress_rate_human": "4.5 KB/s", "egress_rate_human": "2.1 KB/s" }
}
```

### Journal/Logs

#### `systemd_journal_query`
Query journal with filters.

```typescript
systemd_journal_query({
  unit?: string | string[],
  since?: string,        // "-1h", "-30m", "2025-12-29", ISO timestamp
  until?: string,
  priority?: "emerg" | "alert" | "crit" | "err" | "warning" | "notice" | "info" | "debug",
  grep?: string,         // filter log content
  limit?: number,        // max lines (default: 100)
  output?: "short" | "json" | "verbose"
})
```

#### `systemd_journal_tail`
Stream recent/live logs. **Async streaming supported.**

```typescript
systemd_journal_tail({
  unit: string,
  lines?: number,     // initial lines (default: 50)
  follow?: boolean    // live tail (default: false)
})
```

#### `systemd_boot_log`
Important events from current boot.

```typescript
systemd_boot_log({
  priority?: "err" | "warning" | "notice",  // minimum priority
  limit?: number
})
```

### Actions

#### `systemd_start`
Start unit(s). Requires `start_stop` permission.

```typescript
systemd_start({ units: string | string[] })
```

#### `systemd_stop`
Stop unit(s). Requires `start_stop` permission.

```typescript
systemd_stop({ units: string | string[] })
```

#### `systemd_restart`
Restart unit(s). Requires `restart` permission.

```typescript
systemd_restart({ units: string | string[] })
```

#### `systemd_reload`
Reload unit configuration (SIGHUP). Requires `restart` permission.

```typescript
systemd_reload({ units: string | string[] })
```

#### `systemd_enable`
Enable unit for boot. Requires `enable_disable` permission.

```typescript
systemd_enable({ units: string | string[], now?: boolean })
```

#### `systemd_disable`
Disable unit from boot. Requires `enable_disable` permission.

```typescript
systemd_disable({ units: string | string[], now?: boolean })
```

#### `systemd_daemon_reload`
Reload systemd manager. Requires `daemon_reload` permission.

```typescript
systemd_daemon_reload()
```

### Analysis

#### `systemd_analyze_boot`
Boot time analysis.

```typescript
systemd_analyze_boot({
  blame?: boolean,    // show time per unit
  critical_chain?: boolean
})
```

#### `systemd_diagnose`
AI-powered failure diagnosis. Gathers context and optionally uses Haiku fallback.

```typescript
systemd_diagnose({
  unit: string,
  use_ai?: boolean    // use Haiku fallback for synthesis (default: true if configured)
})
```

Returns:
```json
{
  "unit": "scout.service",
  "status": "failed",
  "exit_code": 1,
  "context": {
    "logs": "[... recent logs ...]",
    "dependencies": ["network-online.target"],
    "environment": "No ANTHROPIC_API_KEY"
  },
  "synthesis": {
    "analysis": "Service failed due to missing API key in environment...",
    "suggested_fix": "Add Environment=ANTHROPIC_API_KEY=... to unit file",
    "confidence": "high"
  }
}
```

### Health & Resilience

#### `systemd_health`
Get NEVERHANG v2.0 health status, circuit breaker state, and A.L.A.N. database stats.

```typescript
systemd_health()
```

Returns:
```json
{
  "status": "healthy",
  "circuit_breaker": {
    "state": "closed",
    "failures": 0,
    "last_failure": null,
    "opened_at": null
  },
  "health_monitor": {
    "consecutive_failures": 0,
    "last_check": "2025-12-30T10:15:00Z",
    "degraded": false
  },
  "database": {
    "path": "/home/user/.cache/systemd-mcp/systemd-mcp.db",
    "command_history_count": 1247,
    "health_check_count": 86,
    "oldest_command": "2025-12-23T14:30:00Z"
  },
  "config": {
    "ssh_enabled": false,
    "adaptive_timeout": true,
    "timeouts": {
      "status": 5000,
      "query": 10000,
      "action": 30000,
      "heavy": 60000,
      "diagnostic": 90000
    }
  }
}
```

---

## NEVERHANG v2.0 Architecture

Every systemd command can hang. `systemctl status` on a wedged service waits forever. `journalctl -f` never returns.

**NEVERHANG v2.0 guarantees your MCP server stays responsive.** No command hangs forever. System health is monitored. Failures are classified and handled intelligently.

### Category-Based Timeouts

Commands are classified by expected duration:

| Category | Timeout | Examples |
|----------|---------|----------|
| `status` | 5s | `systemctl status`, `systemctl is-active` |
| `query` | 10s | `journalctl` queries, `systemctl list-units` |
| `action` | 30s | `start`, `stop`, `restart`, `enable`, `disable` |
| `heavy` | 60s | Boot analysis, log streaming |
| `diagnostic` | 90s | AI-powered diagnosis with log synthesis |

### A.L.A.N. Database

**As Long As Necessary** — SQLite database for persistent state across restarts.

```
~/.cache/systemd-mcp/systemd-mcp.db
```

**What it stores:**
- **Circuit breaker state** — Survives restarts, tracks open/closed/half-open state
- **Command history** — 7 days of execution records (success, failure, latency)
- **Health checks** — 24 hours of background ping results
- **P95 latency** — Per-command performance metrics for adaptive timeout

**Automatic cleanup:** Old records pruned on startup (7d commands, 24h health checks).

### Circuit Breaker

Protects against cascade failures when systemd is unresponsive.

| State | Behavior |
|-------|----------|
| **Closed** | Normal operation |
| **Open** | Commands blocked, returns immediately with `CIRCUIT_OPEN` |
| **Half-Open** | Testing recovery with limited requests |

**Configuration:**
- 5 failures in 60s → Circuit opens
- Open duration: 30s
- Recovery threshold: 2 successes to close

**Persistence:** State survives server restarts via A.L.A.N. database.

### Health Monitor

Background thread monitors systemd health independently.

- **Healthy:** Check every 30s
- **Degraded:** Check every 5s (more aggressive)
- **Ping command:** `systemctl --version` (minimal overhead)
- **SSH support:** Uses SSH host when configured

### Adaptive Timeout

When enabled, adjusts timeouts based on observed latency:

```
adjusted_timeout = max(base_timeout, P95_latency * 2)
```

Uses last 100 executions of each command category from A.L.A.N. database.

### Failure Taxonomy

Every failure is classified for intelligent error handling:

| Type | Description |
|------|-------------|
| `timeout` | Command exceeded time limit |
| `connection_failed` | SSH connection failed (remote mode) |
| `auth_failed` | Permission denied |
| `circuit_open` | Circuit breaker is open |
| `command_error` | Non-zero exit code |
| `permission_denied` | Unit blacklisted or permission level insufficient |
| `cancelled` | Operation cancelled by client |

### Process Management

- All subprocesses tracked with PIDs
- Hung processes killed after timeout
- Zombie cleanup on shutdown
- Graceful shutdown handlers (SIGINT, SIGTERM)

### Configuration

```json
{
  "neverhang": {
    "status_timeout_ms": 5000,
    "query_timeout_ms": 10000,
    "action_timeout_ms": 30000,
    "heavy_timeout_ms": 60000,
    "diagnostic_timeout_ms": 90000,

    "circuit_failure_threshold": 5,
    "circuit_failure_window_ms": 60000,
    "circuit_open_duration_ms": 30000,
    "circuit_recovery_threshold": 2,

    "health_check_interval_ms": 30000,
    "health_degraded_interval_ms": 5000,
    "health_check_timeout_ms": 2000,

    "adaptive_timeout": true
  }
}
```

### Why This Architecture?

MCP servers are single-threaded JSON-RPC handlers. When Claude calls `systemctl status` on a wedged service, the entire connection blocks. Claude waits. The user sees nothing. Eventually something times out at a higher layer and the interaction is ruined.

NEVERHANG v1 solved the immediate problem: timeouts. But it was **stateless** - every invocation started fresh with no memory of what happened before.

**A.L.A.N. transforms reactive timeouts into operational intelligence.**

Without persistence:
- Server restarts → circuit resets → retries broken systemd → fails again
- Every timeout is static, regardless of actual system behavior
- No visibility into patterns or trends

With A.L.A.N.:
- Circuit state survives restarts (we don't re-learn through failure)
- P95 latency per category enables adaptive timeouts
- Health trends reveal patterns invisible to stateless systems
- Success rates become diagnostic signals, not just individual outcomes

### Emergent Behaviors

When circuit breaker + adaptive timeout + health monitoring + persistence combine:

**Self-Healing with Memory**
- Gradual recovery through half-open state testing
- Pattern recognition (recurring vs. one-off failures)
- Adaptive thresholds based on historical success rates

**Intelligent Degradation**
- Health monitor shifts 30s → 5s intervals when degraded
- Persists across restarts—server doesn't start naive
- Latency trends visible for root cause analysis

**Operational Visibility for AI**

Claude doesn't have intuition about "the system feels sluggish." Claude operates on data:

| Signal | What Claude Can Do |
|--------|-------------------|
| Circuit open | Don't retry, explain to user |
| P95 jumped 50ms → 2000ms | Something changed, investigate |
| Success rate dropped to 70% | Pattern, not fluke—dig deeper |
| Health trend degrading | Proactive warning before failure |

### What "Fully Functioning" Looks Like

| Scenario | System Behavior |
|----------|----------------|
| **Normal** | Commands execute, latency tracked, circuit closed |
| **Transient failure** | Recorded, circuit tracks but stays closed, next attempt proceeds |
| **Systemic failure** | Circuit opens → commands return `CIRCUIT_OPEN` immediately → health monitor increases frequency → auto-recovery when systemd responds |
| **Degraded performance** | Adaptive timeout adjusts, commands complete, health endpoint shows degradation |
| **Post-restart** | Reads state from A.L.A.N., doesn't start naive, degradation patterns preserved |

This is the difference between a tool and an intelligent subsystem. A.L.A.N. is the memory that makes NEVERHANG wise instead of just cautious.

---

## Fallback AI

Optional Haiku integration for complex log analysis.

```json
{
  "fallback": {
    "enabled": true,
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "api_key_env": "SYSTEMD_MCP_FALLBACK_KEY",
    "max_context_lines": 200,
    "max_tokens": 500
  }
}
```

**When used:**
- `systemd_diagnose` with `use_ai: true`
- Complex failure analysis
- Boot time optimization suggestions

**Not used for:**
- Simple status queries
- Log retrieval
- Start/stop/restart actions

---

## Configuration

### Config File

`~/.config/systemd-mcp/config.json` or specified via `--config`:

```json
{
  "permissions": {
    "read": true,
    "restart": false,
    "start_stop": false,
    "enable_disable": false,
    "daemon_reload": false,
    "whitelist": [],
    "blacklist": [
      "sshd.service",
      "firewalld.service",
      "systemd-*.service"
    ]
  },
  "neverhang": {
    "status_timeout_ms": 5000,
    "query_timeout_ms": 10000,
    "action_timeout_ms": 30000,
    "heavy_timeout_ms": 60000,
    "diagnostic_timeout_ms": 90000,
    "circuit_failure_threshold": 5,
    "circuit_failure_window_ms": 60000,
    "circuit_open_duration_ms": 30000,
    "circuit_recovery_threshold": 2,
    "health_check_interval_ms": 30000,
    "health_degraded_interval_ms": 5000,
    "health_check_timeout_ms": 2000,
    "adaptive_timeout": true
  },
  "fallback": {
    "enabled": false
  }
}
```

### Claude Code Integration

```bash
# Clone and build
git clone https://github.com/ArkTechNWA/systemd-mcp.git
cd systemd-mcp
npm install && npm run build

# Register with Claude Code (read-only by default)
claude mcp add --transport stdio systemd -- node $(pwd)/build/index.js

# Or with permissions enabled
claude mcp add --transport stdio systemd -- \
  bash -c "SYSTEMD_MCP_ALLOW_RESTART=1 node $(pwd)/build/index.js"

# Or full bypass (you own the consequences)
claude mcp add --transport stdio systemd -- \
  bash -c "SYSTEMD_MCP_BYPASS=1 node $(pwd)/build/index.js"
```

---

## Installation

```bash
# npm (when published)
npm install -g @arktechnwa/systemd-mcp

# From source
git clone https://github.com/ArktechNWA/systemd-mcp.git
cd systemd-mcp
npm install
npm link
```

---

## Requirements

- Linux with systemd
- Node.js 18+
- systemctl, journalctl in PATH
- Optional: Anthropic API key for fallback AI

---

## Examples

### Read-only monitoring (default)
```bash
systemd-mcp
# Can: list units, check status, query logs
# Cannot: start, stop, restart, enable, disable
```

### Service operator
```bash
systemd-mcp --config operator.json
# operator.json enables restart + start_stop
# Can manage services but not boot behavior
```

### Full access
```bash
systemd-mcp --bypass-permissions
# Full systemd control
# You own the consequences
```

---

## Security Considerations

1. **Default safe** — Read-only by default
2. **Blacklist critical** — sshd, firewall, systemd protected by default
3. **No credential exposure** — Environment variables not leaked in logs
4. **Audit trail** — All actions logged
5. **User responsibility** — Bypass mode exists but user must enable it

---

## Contributing

Contributions welcome! Please read CONTRIBUTING.md (coming soon).

---

## License

MIT License - See LICENSE file.

---

## Credits

Created by Claude in collaboration with MOD.

Part of the [ArktechNWA MCP Toolshed](https://github.com/ArktechNWA) — Claude's public-facing open source contributions.

Built because AI assistants deserve to see and understand the systems they help maintain.

