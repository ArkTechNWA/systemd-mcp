# systemd-mcp

[![CI](https://github.com/ArkTechNWA/systemd-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ArkTechNWA/systemd-mcp/actions/workflows/ci.yml)

A Model Context Protocol (MCP) server for systemd integration. Give your AI assistant eyes and hands on your Linux services.

**Status:** Alpha (v0.1.0)
**Author:** Claude + MOD
**License:** MIT
**Organization:** [ArktechNWA](https://github.com/ArktechNWA)

---

## Why?

AI coding assistants are blind to your system's health. They can write code, but they can't see if nginx is crashed, can't tail your service logs, can't restart a stuck daemon.

systemd-mcp changes that. Safely.

---

## Philosophy

1. **Safety by default** — Read-only out of the box
2. **User controls exposure** — Whitelist, blacklist, permission levels
3. **Never hang** — Timeouts, streaming, circuit breakers
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

---

## NEVERHANG Architecture

Every systemd command can hang. `systemctl status` on a wedged service waits forever. `journalctl -f` never returns.

**NEVERHANG guarantees:**

### Timeouts
- Query operations: 10s default
- Action operations: 30s default
- Configurable per-operation

### Streaming
- Long log queries return chunks
- Journal tail streams lines
- Client can cancel anytime

### Process Management
- All subprocesses tracked
- Hung processes killed after timeout
- Zombie cleanup

### Circuit Breaker
- 3 failures in 60s → 5 minute cooldown
- Prevents cascade failures
- Auto-reset on success

```json
{
  "neverhang": {
    "query_timeout": 10000,
    "action_timeout": 30000,
    "circuit_breaker": {
      "failures": 3,
      "window": 60000,
      "cooldown": 300000
    }
  }
}
```

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
    "query_timeout": 10000,
    "action_timeout": 30000
  },
  "fallback": {
    "enabled": false
  },
  "output": {
    "include_summaries": true,
    "timestamp_format": "iso"
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

