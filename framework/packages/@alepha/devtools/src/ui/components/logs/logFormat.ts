/**
 * Level → colour. The message text is tinted with the same value, so a red
 * line reads as an error from across the room without having to parse the
 * LEVEL column.
 */
export const LEVEL_COLOR: Record<string, string> = {
  TRACE: "var(--dt-trace)",
  DEBUG: "var(--dt-debug)",
  INFO: "var(--dt-info)",
  WARN: "var(--dt-warn)",
  ERROR: "var(--dt-error)",
  FATAL: "var(--dt-error)",
};

/**
 * Level → message-text colour.
 *
 * Only the levels that mean "look at this" tint the message; INFO and below
 * stay neutral. Tinting every level would spend the signal on the 90% of rows
 * that are routine and leave nothing to mark the 10% that aren't.
 */
export const MESSAGE_COLOR: Record<string, string | undefined> = {
  WARN: "var(--dt-warn)",
  ERROR: "var(--dt-error)",
  FATAL: "var(--dt-error)",
};

/**
 * Drop the `alepha.` namespace prefix.
 *
 * Nearly every framework module is called `alepha.something`, so the prefix is
 * eleven characters of noise repeated on every row — it pushes the message
 * column right without ever distinguishing two entries. Application modules
 * are left alone.
 */
export const shortModule = (module?: string): string => {
  if (!module) return "";
  return module.startsWith("alepha.") ? module.slice("alepha.".length) : module;
};

/**
 * Shorten a correlation id to its leading characters.
 *
 * A request id is compared, never read: you scan for "these three lines share
 * a prefix". A full UUID costs ~250px of table width to say the same thing.
 */
export const shortContext = (context?: string): string => {
  if (!context) return "";
  return context.replace(/-/g, "").slice(0, 4);
};
