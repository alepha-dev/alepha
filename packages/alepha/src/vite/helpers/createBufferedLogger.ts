import type { Logger } from "vite";

interface BufferedLogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  timestamp: Date;
}

export interface BufferedLogger extends Logger {
  /**
   * Flush all buffered log messages to console.
   * Call this on build failure to show what happened.
   */
  flush(): void;

  /**
   * Get all buffered log entries.
   */
  getEntries(): BufferedLogEntry[];

  /**
   * Clear all buffered entries without printing.
   */
  clear(): void;
}

/**
 * Creates a Vite logger that buffers all messages instead of printing them.
 * Useful for silent builds that only show output on failure.
 *
 * @example
 * ```ts
 * const logger = createBufferedLogger();
 * try {
 *   await viteBuild({ customLogger: logger, logLevel: 'info' });
 * } catch (error) {
 *   logger.flush(); // Print all buffered logs
 *   throw error;
 * }
 * ```
 */
export function createBufferedLogger(): BufferedLogger {
  const entries: BufferedLogEntry[] = [];
  const loggedErrors = new WeakSet<Error>();
  const warnedMessages = new Set<string>();
  let hasWarned = false;

  const logger: BufferedLogger = {
    get hasWarned() {
      return hasWarned;
    },

    info(msg: string) {
      entries.push({ level: "info", msg, timestamp: new Date() });
    },

    warn(msg: string) {
      hasWarned = true;
      entries.push({ level: "warn", msg, timestamp: new Date() });
    },

    warnOnce(msg: string) {
      if (warnedMessages.has(msg)) {
        return;
      }
      warnedMessages.add(msg);
      hasWarned = true;
      entries.push({ level: "warn", msg, timestamp: new Date() });
    },

    error(msg: string, options?: { error?: Error | null }) {
      if (options?.error) {
        loggedErrors.add(options.error);
      }
      entries.push({ level: "error", msg, timestamp: new Date() });
    },

    clearScreen() {
      // No-op in buffered mode - we don't clear anything
    },

    hasErrorLogged(error: Error): boolean {
      return loggedErrors.has(error);
    },

    flush() {
      for (const entry of entries) {
        const prefix =
          entry.level === "error"
            ? "\x1b[31m✖\x1b[0m"
            : entry.level === "warn"
              ? "\x1b[33m⚠\x1b[0m"
              : "\x1b[36mℹ\x1b[0m";
        console.log(`${prefix} ${entry.msg}`);
      }
    },

    getEntries() {
      return [...entries];
    },

    clear() {
      entries.length = 0;
      warnedMessages.clear();
      hasWarned = false;
    },
  };

  return logger;
}
