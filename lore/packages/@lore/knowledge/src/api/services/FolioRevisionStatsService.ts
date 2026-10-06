import { AlephaError } from "alepha";

/**
 * Line and word arithmetic over two folio snapshots.
 *
 * Its own service, and a class rather than loose helpers, so the History
 * tab's numbers can be tested against fixed strings without a repository
 * or a request - and so a future caller (the activity feed, an MCP tool)
 * can reuse them through DI instead of copying the algorithm.
 */
export class FolioRevisionStatsService {
  /**
   * Above this many lines on either side the LCS table stops being worth
   * its cost, and the answer stops being worth the wait. Folios are prose
   * capped by a 10-revision window, so this is a backstop against a
   * pathological paste, not a limit anyone should meet.
   */
  protected readonly maxLines = 4000;

  /**
   * Lines added and removed between two snapshots.
   *
   * A longest-common-subsequence length, not a set difference. The cheap
   * version - count the lines present in one side and absent from the
   * other - reports a paragraph that merely MOVED as both an addition and
   * a deletion, so reordering two sections of a folio would claim a
   * rewrite. LCS counts a move as nothing changed, which is what a reader
   * asking "how much of this is new" means.
   *
   * Two rows of the table rather than the whole grid: only the final
   * length is needed, never the path, so the memory is O(min(n, m))
   * instead of O(n × m).
   */
  public lineDiff(
    before: string,
    after: string,
  ): { added: number; removed: number } {
    const a = this.lines(before);
    const b = this.lines(after);

    // Identical text is the common case (a rename or a summary edit
    // touches no content at all) and it is worth not building a table for.
    if (before === after) return { added: 0, removed: 0 };
    if (a.length === 0) return { added: b.length, removed: 0 };
    if (b.length === 0) return { added: 0, removed: a.length };

    const common =
      a.length > this.maxLines || b.length > this.maxLines
        ? this.commonApprox(a, b)
        : this.commonSubsequence(a, b);

    return {
      added: b.length - common,
      removed: a.length - common,
    };
  }

  /**
   * Words in a snapshot, on the same definition the reader would count:
   * runs of non-whitespace.
   */
  public wordCount(text: string): number {
    const trimmed = text.trim();
    return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  }

  protected lines(text: string): string[] {
    // A trailing newline is punctuation, not a line. Without this every
    // snapshot that ends in one reports a phantom empty last line, and any
    // edit that adds or removes it reads as ±1.
    const trimmed = text.replace(/\n$/, "");
    return trimmed === "" ? [] : trimmed.split("\n");
  }

  /**
   * Length of the longest common subsequence of two line arrays.
   */
  protected commonSubsequence(a: string[], b: string[]): number {
    // Iterate the LONGER array outside so the two rows are sized by the
    // shorter one - that is what makes the memory bound hold whichever
    // way round the arguments arrive.
    const [outer, inner] = a.length >= b.length ? [a, b] : [b, a];
    let previous = Array.from<number>({ length: inner.length + 1 }).fill(0);
    let current = Array.from<number>({ length: inner.length + 1 }).fill(0);

    for (const outerLine of outer) {
      for (let j = 0; j < inner.length; j++) {
        current[j + 1] =
          outerLine === inner[j]
            ? previous[j] + 1
            : Math.max(previous[j + 1], current[j]);
      }
      [previous, current] = [current, previous];
      current.fill(0);
    }

    return previous[inner.length];
  }

  /**
   * Multiset overlap - the cheap approximation used above `maxLines`.
   *
   * Counts each line as common as many times as it appears on both sides,
   * which is exactly the "a move looks like a rewrite" behaviour LCS
   * exists to avoid. That is an acceptable trade only because it is
   * unreachable for real folios; if it ever fires routinely, raise the cap
   * or switch to a real diff library rather than living with the numbers.
   */
  protected commonApprox(a: string[], b: string[]): number {
    const counts = new Map<string, number>();
    for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);

    let common = 0;
    for (const line of b) {
      const left = counts.get(line);
      if (left !== undefined && left > 0) {
        counts.set(line, left - 1);
        common++;
      }
    }
    return common;
  }

  /**
   * Guard for a caller that hands over something that is not a string —
   * the snapshots come out of the database, where a legacy row could
   * carry a null.
   */
  public assertText(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw new AlephaError(`Revision ${field} is not text`);
    }
    return value;
  }
}
