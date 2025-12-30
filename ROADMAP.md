# systemd-mcp Roadmap

Development phases for systemd-mcp. Each phase is independently useful.

---

## Phase 0: Foundation
**Goal:** Project scaffolding, zero functionality

- [x] Create project structure
- [x] Write README.md with full spec
- [x] Write ROADMAP.md
- [ ] LICENSE (MIT)
- [ ] package.json with dependencies
- [ ] TypeScript configuration
- [ ] ESLint + Prettier config
- [ ] .gitignore
- [ ] Basic MCP server skeleton (stdio transport)
- [ ] Config file loading

**Deliverable:** `npm install && npm run build` works, MCP connects but has no tools

---

## Phase 1: Read-Only Core
**Goal:** Safe perception — status, logs, timers

### Tools
- [ ] `systemd_list_units` — List units with filtering
- [ ] `systemd_unit_status` — Detailed status + recent logs
- [ ] `systemd_failed_units` — What's broken?
- [ ] `systemd_timers` — Timer overview

### Infrastructure
- [ ] systemctl wrapper with NEVERHANG timeouts
- [ ] Output parsing (status → structured JSON)
- [ ] Status icons (✓ ✗ ○ ◐)
- [ ] Summary generation

**Deliverable:** Claude can see system health. Zero write capabilities. Safe.

---

## Phase 2: Journal Integration
**Goal:** Log access with filtering and streaming

### Tools
- [ ] `systemd_journal_query` — Filtered log queries
- [ ] `systemd_journal_tail` — Recent logs (non-streaming first)
- [ ] `systemd_boot_log` — This boot's events

### Infrastructure
- [ ] journalctl wrapper with NEVERHANG
- [ ] Time parsing (relative: "-1h", absolute: ISO)
- [ ] Priority filtering
- [ ] Grep support
- [ ] Output limiting

**Deliverable:** Claude can investigate logs. Still read-only.

---

## Phase 3: Permission System
**Goal:** Granular control before enabling writes

### Config
- [ ] Permission levels (read, restart, start_stop, enable_disable, daemon_reload)
- [ ] Whitelist patterns
- [ ] Blacklist patterns (with defaults)
- [ ] `--bypass-permissions` flag
- [ ] Environment variable overrides

### Infrastructure
- [ ] Permission checking middleware
- [ ] Config file loading (~/.config/systemd-mcp/config.json)
- [ ] Permission denied errors (helpful messages)
- [ ] Audit logging

**Deliverable:** Permission system ready. Still no write tools exposed.

---

## Phase 4: Actions
**Goal:** Write capabilities behind permission gates

### Tools
- [ ] `systemd_start` — Start units
- [ ] `systemd_stop` — Stop units
- [ ] `systemd_restart` — Restart units
- [ ] `systemd_reload` — Reload config (SIGHUP)
- [ ] `systemd_enable` — Enable for boot
- [ ] `systemd_disable` — Disable from boot
- [ ] `systemd_daemon_reload` — Reload systemd manager

### Infrastructure
- [ ] Action confirmation in output
- [ ] Post-action status check
- [ ] Rollback information (what was the previous state)

**Deliverable:** Full service management. Permission-gated.

---

## Phase 5: NEVERHANG Hardening
**Goal:** Bulletproof reliability

### Features
- [ ] Circuit breaker (3 failures → cooldown)
- [ ] Process timeout enforcement
- [ ] Hung process killing
- [ ] Partial result returns on timeout
- [ ] Graceful degradation

### Infrastructure
- [ ] AbortController integration
- [ ] Subprocess tracking
- [ ] Zombie cleanup
- [ ] Health self-check tool

**Deliverable:** Cannot hang the MCP server, ever.

---

## Phase 6: Streaming
**Goal:** Real-time log tailing

### Tools
- [ ] `systemd_journal_tail` with `follow: true`

### Infrastructure
- [ ] MCP streaming support (if available) or polling fallback
- [ ] Client cancellation
- [ ] Backpressure handling

**Deliverable:** Live log streaming.

---

## Phase 7: Analysis & AI Fallback
**Goal:** Intelligent diagnosis

### Tools
- [ ] `systemd_dependencies` — Dependency tree
- [ ] `systemd_analyze_boot` — Boot time analysis
- [ ] `systemd_diagnose` — AI-powered failure diagnosis

### Infrastructure
- [ ] Haiku API integration
- [ ] Context gathering (logs + status + deps)
- [ ] Prompt engineering for diagnosis
- [ ] Fallback when AI unavailable

**Deliverable:** "Why did this break?" gets intelligent answers.

---

## Phase 8: Polish
**Goal:** Production-ready

- [ ] Comprehensive error messages
- [ ] Documentation improvements
- [ ] Example configs for common scenarios
- [ ] Performance optimization
- [ ] Test suite
- [ ] CI/CD pipeline
- [ ] npm publish to @arktechnwa scope

**Deliverable:** Ready for public release.

---

## Future Ideas (Post-1.0)

- **D-Bus integration** — Richer data, no subprocess spawning
- **Unit file editing** — Create/modify service definitions
- **Resource monitoring** — CPU/memory trends over time
- **Notifications** — Alert on service failures
- **Multi-host** — Manage multiple systems via SSH
- **Web dashboard** — Visual system overview

---

## Version Targets

| Version | Phase | Description |
|---------|-------|-------------|
| 0.1.0 | 1 | Read-only status |
| 0.2.0 | 2 | Journal access |
| 0.3.0 | 3 | Permission system |
| 0.4.0 | 4 | Service actions |
| 0.5.0 | 5 | NEVERHANG hardening |
| 0.6.0 | 6 | Streaming |
| 0.7.0 | 7 | AI diagnosis |
| 1.0.0 | 8 | Production release |

---

## Current Focus

**Phase 0** — Foundation and scaffolding.
