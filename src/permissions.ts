/**
 * Permission checking for systemd-mcp
 */

import type { Config } from "./config.js";

type PermissionLevel = "read" | "restart" | "start_stop" | "enable_disable" | "daemon_reload";

/**
 * Check if a permission level is enabled
 */
export function checkPermission(config: Config, level: PermissionLevel): boolean {
  return config.permissions[level] === true;
}

/**
 * Check if a unit is accessible (not blacklisted, or whitelisted if whitelist exists)
 */
export function checkUnitAccess(config: Config, unit: string): boolean {
  const { whitelist, blacklist } = config.permissions;

  // Blacklist always wins
  if (matchesPattern(unit, blacklist)) {
    return false;
  }

  // If whitelist is empty, allow all (subject to blacklist)
  if (whitelist.length === 0) {
    return true;
  }

  // Otherwise, must match whitelist
  return matchesPattern(unit, whitelist);
}

/**
 * Check if a unit matches any pattern in a list
 * Supports * wildcards
 */
function matchesPattern(unit: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (globMatch(unit, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob matching with * wildcard
 */
function globMatch(str: string, pattern: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*"); // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}
