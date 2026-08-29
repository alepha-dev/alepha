import { AlephaError } from "alepha";

/**
 * Fractional indexing for `quests.boardRank`.
 *
 * A card's position is a STRING compared lexicographically, not a number.
 * A float looks simpler and fails silently: repeatedly dropping a card
 * between the same two neighbours halves the gap each time, and after ~50
 * insertions the two doubles are equal, at which point the board quietly
 * reorders itself. A string index can always be extended by one more
 * character, so there is no depth at which it stops working.
 *
 * The generated rank is only ever compared to its own neighbours, so the
 * alphabet and the exact midpoint do not matter — what matters is the
 * invariant every method here maintains: `a < between(a, b) < b`.
 *
 * ⚠️ `"a"` (digit 0) is never produced as a whole rank. Nothing sorts
 * before it: `"a" + anything` is GREATER than `"a"`, because a longer
 * string sharing a prefix sorts after it. Reserving it keeps "insert at the
 * very top" always answerable.
 */
export class BoardRank {
  /**
   * The rank alphabet: 26 lowercase letters, so a rank sorts identically in
   * JavaScript, in SQLite's default `BINARY` collation and in a URL.
   */
  protected readonly DIGITS = "abcdefghijklmnopqrstuvwxyz";
  protected readonly BASE = this.DIGITS.length;

  /**
   * A rank strictly between `before` and `after`.
   *
   * `undefined` means unbounded: no `before` is the head of the column, no
   * `after` is the tail, neither is an empty column.
   */
  between(before?: string, after?: string): string {
    const a = before ?? "";
    const b = after;

    if (b !== undefined && a >= b) {
      throw new AlephaError(
        `Cannot rank between "${a}" and "${b}": they are out of order.`,
      );
    }

    return this.midpoint(a, b);
  }

  /**
   * Ranks for a whole list, evenly spread, for backfilling a column that
   * has never been ranked. Generated in one pass rather than by repeated
   * `between` calls so the initial spread stays short and even.
   */
  sequence(count: number): string[] {
    if (count <= 0) return [];
    const out: string[] = [];
    let previous: string | undefined;
    for (let i = 0; i < count; i++) {
      previous = this.between(previous, undefined);
      out.push(previous);
    }
    return out;
  }

  /**
   * The recursive half. `b === undefined` means "no upper bound".
   */
  protected midpoint(a: string, b: string | undefined): string {
    // Walk past whatever the two already agree on and rank inside the
    // remainder, which keeps ranks short instead of restating a shared
    // prefix every time.
    //
    // ⚠️ A position `a` does not reach counts as the ZERO digit, not as
    // "different". Without that, ranking above the head stalls: `a` is ""
    // and `b` is "an", the loop finds no shared prefix, and the digits 0
    // and 0 are not two apart, so the descent returns "an" again — equal
    // to the bound it was supposed to beat.
    if (b !== undefined) {
      let shared = 0;
      while (shared < b.length && (a[shared] ?? this.DIGITS[0]) === b[shared]) {
        shared++;
      }
      if (shared > 0) {
        return (
          b.slice(0, shared) + this.midpoint(a.slice(shared), b.slice(shared))
        );
      }
    }

    const digitA = a === "" ? 0 : this.valueOf(a[0]);
    const digitB = b === undefined || b === "" ? this.BASE : this.valueOf(b[0]);

    if (digitB - digitA > 1) {
      // Room for a digit between them, so one character is enough. Rounded
      // rather than floored so the result is never `digitA` itself, which
      // is what would let a rank end in the reserved zero.
      return this.DIGITS[Math.round((digitA + digitB) / 2)];
    }

    // The digits are consecutive, so nothing fits at this position.
    if (b !== undefined && b.length > 1) {
      // `b` has more to give: drop its tail and the truncation alone is
      // already below it, and above `a`.
      return b.slice(0, 1);
    }

    // `b` is unbounded or a single digit, so keep `a`'s digit and go one
    // character deeper, where `a`'s remainder is the new lower bound and
    // there is no upper bound at all.
    return this.DIGITS[digitA] + this.midpoint(a.slice(1), undefined);
  }

  protected valueOf(digit: string): number {
    const index = this.DIGITS.indexOf(digit);
    if (index === -1) {
      throw new AlephaError(`Invalid rank digit: "${digit}".`);
    }
    return index;
  }
}
