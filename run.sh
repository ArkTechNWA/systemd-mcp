#!/bin/bash
# run.sh - Wrapper script for systemd-mcp
#
# Usage with Claude Code:
#   claude mcp add --transport stdio systemd -- bash /path/to/run.sh
#
# Environment variables:
#   SYSTEMD_MCP_BYPASS=1          - Enable all permissions
#   SYSTEMD_MCP_ALLOW_RESTART=1   - Enable restart permission
#   SYSTEMD_MCP_ALLOW_START_STOP=1 - Enable start/stop permission

# Optional: Load API key for Haiku fallback
if [ -f ~/.config/systemd-mcp/api-key ]; then
  export ANTHROPIC_API_KEY=$(cat ~/.config/systemd-mcp/api-key)
fi

exec node "$(dirname "$0")/build/index.js" "$@"
