# systemd-mcp Roadmap

## v0.1.1 - Alpha Release ✓

- [x] MCP server with stdio transport
- [x] Config file loading
- [x] Permission system (read/restart/start_stop/enable_disable/daemon_reload)
- [x] Unit whitelist/blacklist with glob patterns
- [x] Default blacklist (sshd, firewall, systemd-*)
- [x] NEVERHANG timeouts on all operations
- [x] Haiku AI fallback for diagnosis
- [x] CI workflow
- [x] Fixed parsing bugs (failed_units, timers)

---

## v0.2.0 - SSH Support ✓

- [x] SSH remote host support
- [x] `SYSTEMD_MCP_SSH_HOST` environment variable
- [x] Config file `ssh.host` option
- [x] Commands wrapped with `ssh <host> '<cmd>'` when enabled

---

## v0.3.0 - Multi-Instance & Unit Files ✓

- [x] Multi-instance documentation (local + remote monitoring)
- [x] `systemd_cat_unit` tool - view unit file contents

---

## v0.4.0 - Resource Monitoring ✓

- [x] `systemd_unit_resources` - point-in-time resource snapshot
- [x] `systemd_sample_resources` - live sampling with trend calculation
- [x] Human-readable formatting (bytes, nanoseconds)
- [x] Memory stability detection

---

## v0.5.0 - NEVERHANG v2.0 + A.L.A.N. ✓

- [x] **A.L.A.N. database** (As Long As Necessary) - SQLite persistent state
  - [x] Circuit breaker state survives restarts
  - [x] Command history with latency tracking (7d retention)
  - [x] Health check trends (24h retention)
  - [x] P95 latency per command category
  - [x] Auto-cleanup on startup
- [x] **NEVERHANG v2.0**
  - [x] Five-tier category timeouts (status/query/action/heavy/diagnostic)
  - [x] Circuit breaker with half-open recovery
  - [x] Health monitor with degradation detection
  - [x] Adaptive timeout using historical P95
  - [x] Failure taxonomy for intelligent error handling
- [x] **`systemd_health` tool** - operational visibility endpoint
- [x] Graceful shutdown handlers (SIGINT, SIGTERM)
- [x] README rewrite with architecture philosophy

---

## v0.6.0 - Enhanced AI Hints (planned)

- [ ] Richer tool descriptions for AI reasoning
- [ ] Usage examples in tool metadata
- [ ] Situational hints ("use this when...")

---

## v0.7.0 - Cross-Host Metrics (planned)

- [ ] postgres-mcp integration option
- [ ] Multi-host metrics aggregation
- [ ] Shared visibility across instances

---

## v1.0.0 - Production

- [ ] Live log streaming (follow mode)
- [ ] D-Bus integration (richer data, no subprocess spawning)
- [ ] Test suite
- [ ] npm publish (if demand exists)

---

**Status:** v0.5.0 released (NEVERHANG v2.0 + A.L.A.N. database)
