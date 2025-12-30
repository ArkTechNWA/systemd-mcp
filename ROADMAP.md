# systemd-mcp Roadmap

## v0.1.0 - Alpha Release ✓

All core functionality complete:

- [x] MCP server with stdio transport
- [x] Config file loading
- [x] Permission system (read/restart/start_stop/enable_disable/daemon_reload)
- [x] Unit whitelist/blacklist with glob patterns
- [x] Default blacklist (sshd, firewall, systemd-*)
- [x] NEVERHANG timeouts on all operations
- [x] Haiku AI fallback for diagnosis
- [x] CI workflow

### 16 Tools Implemented

| Category | Tools |
|----------|-------|
| Status | `list_units`, `unit_status`, `failed_units`, `timers`, `dependencies` |
| Journal | `journal_query`, `journal_tail`, `boot_log` |
| Actions | `start`, `stop`, `restart`, `reload`, `enable`, `disable`, `daemon_reload` |
| Analysis | `analyze_boot`, `diagnose` |

---

## Future

### v0.2.0 - Enhancements
- [ ] Live log streaming (follow mode)
- [ ] Unit file viewing
- [ ] Resource usage trends
- [ ] Circuit breaker improvements

### v1.0.0 - Production
- [ ] D-Bus integration (richer data, no subprocess spawning)
- [ ] Multi-host support (SSH)
- [ ] Test suite
- [ ] npm publish (if demand exists)

---

**Status:** v0.1.0 released, CI passing, ready for use.
