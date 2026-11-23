/**
 * A line diff, the same on every runtime (#Q4135, folio #F1540: one
 * implementation, in JS, on both backends): Myers' O(ND) algorithm over
 * the lines left once the common prefix and suffix are set aside, bounded
 * by an edit-distance ceiling so a pathological or minified file costs a
 * known amount of CPU and answers "too large" past it, never a timeout.
 *
 * No dependency: the whole thing is this class, so Node and the Worker run
 * the same bytes and one spec covers both.
 */
export class LineDiff {
  /**
   * The most edits (inserted plus deleted lines) a diff searches for. Its
   * memory is about the square of this in 32-bit integers (9 MB here).
   */
  public static readonly MAX_EDIT_DISTANCE = 1500;

  /**
   * Lines of unchanged context around each change, as `git diff` shows.
   */
  public static readonly CONTEXT = 3;

  /**
   * The edit script from `a` to `b`, or undefined past `maxEditDistance`.
   * Within a run of changes, deletions come before insertions.
   */
  public static diff(
    a: string[],
    b: string[],
    maxEditDistance = LineDiff.MAX_EDIT_DISTANCE,
  ): LineDiffOp[] | undefined {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
      start += 1;
    }
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    const middle = LineDiff.myers(
      LineDiff.intern(a.slice(start, endA), b.slice(start, endB)),
      maxEditDistance,
    );
    if (!middle) return undefined;
    const ops: LineDiffOp[] = [];
    for (let i = 0; i < start; i++) ops.push({ kind: "equal", a: i, b: i });
    for (const op of middle) {
      ops.push({
        kind: op.kind,
        a: op.a === undefined ? undefined : op.a + start,
        b: op.b === undefined ? undefined : op.b + start,
      } as LineDiffOp);
    }
    for (let i = 0; i < a.length - endA; i++) {
      ops.push({ kind: "equal", a: endA + i, b: endB + i });
    }
    return LineDiff.ordered(ops);
  }

  /**
   * Both sides as integers, equal lines equal numbers: Myers compares a
   * number where it would compare a string.
   */
  protected static intern(
    a: string[],
    b: string[],
  ): { a: Int32Array; b: Int32Array } {
    const ids = new Map<string, number>();
    const of = (lines: string[]) => {
      const out = new Int32Array(lines.length);
      lines.forEach((line, index) => {
        let id = ids.get(line);
        if (id === undefined) {
          id = ids.size;
          ids.set(line, id);
        }
        out[index] = id;
      });
      return out;
    };
    return { a: of(a), b: of(b) };
  }

  /**
   * Myers' greedy forward search, keeping each round's frontier to walk the
   * path back. Indices are 0-based into the given arrays.
   */
  protected static myers(
    seq: { a: Int32Array; b: Int32Array },
    maxD: number,
  ): LineDiffOp[] | undefined {
    const { a, b } = seq;
    const n = a.length;
    const m = b.length;
    if (n === 0 && m === 0) return [];
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, maxD); d++) {
      // The frontier before this round, over the diagonals it may read.
      trace.push(v.slice(offset - d - 1, offset + d + 2));
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
            ? v[offset + k + 1]!
            : v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x += 1;
          y += 1;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
      if (found >= 0) break;
    }
    if (found < 0) return undefined;

    const ops: LineDiffOp[] = [];
    let x = n;
    let y = m;
    for (let d = found; d >= 0; d--) {
      const frontier = trace[d]!;
      const at = (k: number) => frontier[k + d + 1]!;
      const k = x - y;
      let prevK: number;
      if (d === 0) {
        prevK = 0;
      } else {
        prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      }
      const prevX = d === 0 ? 0 : at(prevK);
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        ops.push({ kind: "equal", a: x - 1, b: y - 1 });
        x -= 1;
        y -= 1;
      }
      if (d > 0) {
        if (x === prevX) {
          ops.push({ kind: "insert", b: y - 1 });
          y -= 1;
        } else {
          ops.push({ kind: "delete", a: x - 1 });
          x -= 1;
        }
      }
    }
    return ops.toReversed();
  }

  /**
   * Each run of changes as its deletions, then its insertions.
   */
  protected static ordered(ops: LineDiffOp[]): LineDiffOp[] {
    const out: LineDiffOp[] = [];
    let deletes: LineDiffOp[] = [];
    let inserts: LineDiffOp[] = [];
    const flush = () => {
      out.push(...deletes, ...inserts);
      deletes = [];
      inserts = [];
    };
    for (const op of ops) {
      if (op.kind === "equal") {
        flush();
        out.push(op);
      } else if (op.kind === "delete") {
        deletes.push(op);
      } else {
        inserts.push(op);
      }
    }
    flush();
    return out;
  }

  /**
   * The edit script cut into hunks of changes with `context` unchanged
   * lines around them, two hunks closer than twice that merged into one,
   * as `git diff` cuts them. Line numbers are 1-based.
   */
  public static hunks(
    ops: LineDiffOp[],
    context = LineDiff.CONTEXT,
  ): LineDiffHunk[] {
    const changed: number[] = [];
    ops.forEach((op, index) => {
      if (op.kind !== "equal") changed.push(index);
    });
    if (changed.length === 0) return [];
    const ranges: Array<[number, number]> = [];
    for (const index of changed) {
      const from = Math.max(0, index - context);
      const to = Math.min(ops.length - 1, index + context);
      const last = ranges[ranges.length - 1];
      if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
      else ranges.push([from, to]);
    }
    return ranges.map(([from, to]) => {
      const slice = ops.slice(from, to + 1);
      // Where the hunk starts on each side: the first line it names there,
      // or, for a side it only inserts into or deletes from, the line after
      // the previous one, as git counts it.
      const before = ops.slice(0, from);
      const oldBefore = before.filter((op) => op.kind !== "insert").length;
      const newBefore = before.filter((op) => op.kind !== "delete").length;
      const oldLines = slice.filter((op) => op.kind !== "insert").length;
      const newLines = slice.filter((op) => op.kind !== "delete").length;
      return {
        oldStart: oldLines ? oldBefore + 1 : oldBefore,
        oldLines,
        newStart: newLines ? newBefore + 1 : newBefore,
        newLines,
        ops: slice,
      };
    });
  }
}

/**
 * One step of an edit script: indices into the old side (`a`) and the new
 * side (`b`), 0-based.
 */
export type LineDiffOp =
  | { kind: "equal"; a: number; b: number }
  | { kind: "delete"; a: number; b?: undefined }
  | { kind: "insert"; b: number; a?: undefined };

export interface LineDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: LineDiffOp[];
}
