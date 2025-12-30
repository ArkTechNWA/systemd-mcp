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

---

## v0.2.0 - SSH Support ✓

- [x] SSH remote host support
- [x] Config file `ssh.host` option

---

## v0.3.0 - Multi-Instance & Unit Files ✓

- [x] Multi-instance documentation
- [x] `systemd_cat_unit` tool

---

## v0.4.0 - Resource Monitoring ✓

- [x] `systemd_unit_resources` - point-in-time snapshot
- [x] `systemd_sample_resources` - live sampling with trends

---

## v0.5.0 - NEVERHANG v2.0 + A.L.A.N. ✓

- [x] A.L.A.N. database - persistent state across restarts
- [x] NEVERHANG v2.0 - circuit breaker, adaptive timeouts, health monitoring
- [x] `systemd_health` tool
- [x] Cleaner tool descriptions (no jargon)

---

## v1.0.0 - Production

- [ ] Test suite
- [ ] npm publish

---

## Future (user request → we build)

Nothing planned. Got an idea? Open an issue.

---

**Status:** v0.5.0 released
