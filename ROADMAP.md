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

## v0.3.0 - Multi-Instance & Unit Files (current)

- [ ] Multi-instance documentation (local + remote monitoring)
- [ ] `systemd_cat_unit` tool - view unit file contents

---

## v0.4.0 - Streaming & Trends

- [ ] Live log streaming (follow mode)
- [ ] Resource usage trends
- [ ] Circuit breaker improvements

---

## v1.0.0 - Production

- [ ] D-Bus integration (richer data, no subprocess spawning)
- [ ] Unit file viewing
- [ ] Test suite
- [ ] npm publish (if demand exists)

---

**Status:** v0.2.0 released, working on v0.3.0
