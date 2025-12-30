/**
 * Utility functions for systemd-mcp
 */

/**
 * Wrap a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Parse systemctl show output into key-value pairs
 */
export function parseSystemctlShow(output: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      const key = line.substring(0, idx);
      const value = line.substring(idx + 1);
      result[key] = value;
    }
  }

  return result;
}

/**
 * Format uptime from a timestamp
 */
export function formatUptime(timestamp: string): string {
  try {
    const started = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - started.getTime();

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  } catch {
    return "unknown";
  }
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}
