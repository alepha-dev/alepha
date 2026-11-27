/**
 * One line of a diff: unchanged, added in the newer text, or removed from
 * the older one. A `gap` stands for unchanged lines left out between two
 * changes, `text` holding how many.
 */
export interface AssistantDiffLine {
  kind: "same" | "add" | "del" | "gap";
  text: string;
}

/**
 * A line diff of a folio's content before and after an update the assistant
 * asks to make (#Q4547): the longest common subsequence, exact and fast
 * enough for a folio a few hundred lines long, with unchanged runs cut down
 * to {@link CONTEXT} lines around each change. Past {@link MAX_LINES} it
 * gives up rather than freeze the card, and answers `undefined`; an empty
 * array means the two texts are the same.
 */
export class AssistantLineDiff {
  public static readonly MAX_LINES = 2_000;
  public static readonly CONTEXT = 2;

  public static diff(
    before: string,
    after: string,
  ): AssistantDiffLine[] | undefined {
    const a = before.split("\n");
    const b = after.split("\n");
    if (
      a.length > AssistantLineDiff.MAX_LINES ||
      b.length > AssistantLineDiff.MAX_LINES
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
    const out: AssistantDiffLine[] = [];
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
    return AssistantLineDiff.trim(out);
  }

  /**
   * The changes with {@link CONTEXT} unchanged lines on either side, every
   * longer unchanged run folded into one `gap`; a run of one line is kept,
   * since its gap would be no shorter. A diff with no change comes back
   * empty.
   */
  public static trim(lines: AssistantDiffLine[]): AssistantDiffLine[] {
    const near = lines.map(() => false);
    lines.forEach((line, index) => {
      if (line.kind === "same") return;
      const from = Math.max(0, index - AssistantLineDiff.CONTEXT);
      const to = Math.min(lines.length - 1, index + AssistantLineDiff.CONTEXT);
      for (let k = from; k <= to; k++) near[k] = true;
    });
    if (!near.some(Boolean)) return [];
    const out: AssistantDiffLine[] = [];
    let skipped: AssistantDiffLine[] = [];
    const flush = () => {
      if (skipped.length === 1) out.push(skipped[0]);
      if (skipped.length > 1) {
        out.push({ kind: "gap", text: String(skipped.length) });
      }
      skipped = [];
    };
    lines.forEach((line, index) => {
      if (near[index]) {
        flush();
        out.push(line);
      } else {
        skipped.push(line);
      }
    });
    flush();
    return out;
  }
}
