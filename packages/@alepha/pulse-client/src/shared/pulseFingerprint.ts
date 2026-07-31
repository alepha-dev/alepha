/**
 * Builds the canonical string that identifies "the same error".
 *
 * Exported rather than reimplemented on each side: the app aggregates by
 * fingerprint before sending, the sink groups by it, and the sink's own
 * forwarder sends it onward. Three implementations of one rule would drift, and
 * the drift shows up as duplicate groups that nobody can merge afterwards.
 *
 * Returns the string, not the hash. Every consumer already has a hasher it
 * trusts (`CryptoProvider`, `node:crypto`, WebCrypto), and keeping this pure
 * means it can be tested without one — and used in the browser, which has no
 * synchronous SHA-256.
 *
 * **No app identifier goes in.** Scoping is carried by the ingest key: two apps
 * sending the same crash are two groups because they are two apps, not because
 * their fingerprints differ. That also makes a fingerprint portable — the same
 * error keeps its identity when an app moves between sinks.
 */
export const pulseFingerprintSource = (name: string, stack: string): string =>
  `${name}:${normalizeFrame(throwSiteFrame(stack))}`;

/**
 * The frame the error was thrown from: the first `at …` line, or failing that
 * the first non-empty one.
 *
 * A stack without `at` frames still has to fingerprint to something stable —
 * an empty string would collapse every such error into one group.
 */
const throwSiteFrame = (stack: string): string => {
  const lines = stack.split("\n");
  return (
    lines.find((l) => /^\s*at\s/.test(l)) ??
    lines.find((l) => l.trim() !== "") ??
    ""
  );
};

/**
 * Strips the volatile parts of a stack frame so the fingerprint survives a
 * deploy.
 *
 * Bundlers emit content-hashed filenames (`entry.iHryQ0pA.js`) and the exact
 * `:line:col` moves whenever the bundle is rebuilt. Without this, every deploy
 * turns one long-standing bug into a brand-new group and the history of that
 * bug is lost each time it is *not* fixed.
 *
 * - `name.<hash>.ext` → `name.ext` (hash = 6+ alphanumerics between dots)
 * - trailing `:line:col` or `:line` removed
 */
const normalizeFrame = (frame: string): string =>
  frame
    .trim()
    .replace(/\.[A-Za-z0-9_-]{6,}\.(m?js|css)\b/g, ".$1")
    .replace(/:\d+(?::\d+)?(?=\)?$)/g, "");
