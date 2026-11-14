/**
 * One line of a diff: unchanged, added in the newer text, or removed from
 * the older one.
 */
export interface StackDiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/**
 * A line diff of two compose files, for the revisions tab: the longest common
 * subsequence, which is exact and fast enough for files a few hundred lines
 * long. Past {@link MAX_LINES} it gives up rather than freeze the page, and
 * says so through an empty answer.
 */
export class StackLineDiff {
  public static readonly MAX_LINES = 2_000;

  public static diff(
    before: string,
    after: string,
  ): StackDiffLine[] | undefined {
    const a = before.split("\n");
    const b = after.split("\n");
    if (
      a.length > StackLineDiff.MAX_LINES ||
      b.length > StackLineDiff.MAX_LINES
    ) {
      return undefined;
    }
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
      Array.from({ length: b.length + 1 }, () => 0),
    );
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i][j] =
          a[i] === b[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const out: StackDiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ kind: "same", text: a[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        out.push({ kind: "del", text: a[i++] });
      } else {
        out.push({ kind: "add", text: b[j++] });
      }
    }
    while (i < a.length) out.push({ kind: "del", text: a[i++] });
    while (j < b.length) out.push({ kind: "add", text: b[j++] });
    return out;
  }
}
