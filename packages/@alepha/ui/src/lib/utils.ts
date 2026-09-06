import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A byte count as a person reads it: `5.2 GB`, `640 KB`, `0 B`.
 *
 * One implementation, because there were three: two private copies in this
 * package (`control-upload`, `admin-files`) that disagreed about whether TB
 * exists, and a third in Lore that stopped at MB. A file listing and a host's
 * disk are the same question, and the answer should not depend on which screen
 * asked it.
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
