/**
 * `cn` is shadcn's own engine for Tailwind class merging: the same API and
 * output as `clsx` + `tailwind-merge`, with zero dependencies. This module is
 * the one import path for it, hand-maintained blocks and stock primitives
 * alike; `scripts/sync.ts` rewrites the registry's direct `"cn"` import back
 * through here.
 */
export { cn } from "cn";

/**
 * A byte count as a person reads it: `5.2 GB`, `640 KB`, `0 B`.
 *
 * One implementation, because there were four: two private copies in this
 * package (`control-upload`, `admin-files`) that disagreed about whether TB
 * exists, and two in Lore, one of which stopped at MB. A file listing and a
 * host's disk are the same question, and the answer should not depend on
 * which screen asked it.
 *
 * Binary units with decimal names, which is what every operating system shows
 * and therefore what an operator compares against. `undefined` is empty rather
 * than zero: a size nobody measured is not a size of nothing.
 */
export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.abs(n)) / Math.log(1024)),
  );
  // Bytes are whole things: "512.0 B" reads as a rounding of something else.
  if (i === 0) return `${Math.round(n)} B`;
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}
