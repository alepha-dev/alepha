export type DiffLineType = "add" | "remove" | "same";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Compute a line-based diff between two strings using a longest-common-
 * subsequence walk. Returns an ordered list of lines tagged as added,
 * removed, or unchanged — enough to render a side-less unified diff for small
 * JSON blobs without pulling in a diff dependency.
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "remove", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: "remove", text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ type: "add", text: b[j] });
    j++;
  }
  return out;
};
