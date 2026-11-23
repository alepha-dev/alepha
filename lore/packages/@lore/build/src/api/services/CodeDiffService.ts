import { $inject, type Infer } from "alepha";

import { GitBackend } from "../backends/GitBackend.ts";
import type { codeDiffFileSchema } from "../schemas/codeDiffFileSchema.ts";
import type { codeDiffLineSchema } from "../schemas/codeDiffLineSchema.ts";
import type { codeDiffSchema } from "../schemas/codeDiffSchema.ts";
import { type GitTreeChange, GitTreeDiff } from "./GitTreeDiff.ts";
import { LineDiff } from "./LineDiff.ts";

type DiffFile = Infer<typeof codeDiffFileSchema>;
type DiffLine = Infer<typeof codeDiffLineSchema>;

/**
 * The diff between two commits (#Q4135), the same on both backends: the
 * changed paths from the tree diff, then each file's hunks from
 * {@link LineDiff}, under explicit caps that answer a typed state rather
 * than a timeout.
 *
 * - **The file list** comes from the trees alone (no blob read), at most
 *   {@link CodeDiffService.MAX_FILES} files (`partial` past it), paged by
 *   {@link CodeDiffService.PAGE_SIZE}.
 * - **Hunks are eager for the first files of a page**: up to
 *   {@link CodeDiffService.EAGER_FILES} that are not generated, within
 *   {@link CodeDiffService.EAGER_BYTES} of blobs read. The rest, and every
 *   generated file (a lockfile, a minified bundle, a snapshot), answer their
 *   tree-level entry and load on demand (`file`).
 * - **A file over a cap** ({@link CodeDiffService.MAX_BLOB_BYTES} a side,
 *   {@link CodeDiffService.MAX_LINES} lines a side, or past the line diff's
 *   edit distance) answers `too_large`; a binary one `binary`.
 *
 * A line's anchor is `${path}:${side}:${line}`: `old` for a deleted line,
 * `new` for an added or an unchanged one. Pull request line comments
 * (#E169) hang off it.
 */
export class CodeDiffService {
  public static readonly MAX_FILES = 1000;
  public static readonly PAGE_SIZE = 50;
  public static readonly EAGER_FILES = 20;
  public static readonly EAGER_BYTES = 1024 * 1024;
  public static readonly MAX_BLOB_BYTES = 256 * 1024;
  public static readonly MAX_LINES = 5000;

  /**
   * Generated files: collapsed, loaded only when someone opens one.
   */
  public static readonly GENERATED = [
    /(^|\/)yarn\.lock$/,
    /(^|\/)package-lock\.json$/,
    /(^|\/)pnpm-lock\.yaml$/,
    /(^|\/)go\.sum$/,
    /(^|\/)Cargo\.lock$/,
    /\.min\.(js|css)$/,
    /\.map$/,
    /\.snap$/,
  ];

  protected readonly backend = $inject(GitBackend);
  protected readonly treeDiff = $inject(GitTreeDiff);

  /**
   * The diff from commit `from` (the empty tree when undefined: a root
   * commit) to commit `to`, one page of files.
   */
  public async diff(
    ref: string,
    from: string | undefined,
    to: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<Infer<typeof codeDiffSchema>> {
    const [fromTree, toTree] = await this.treesOf(ref, from, to);
    const result = await this.treeDiff.diff(ref, fromTree, toTree, {
      maxChanges: CodeDiffService.MAX_FILES,
    });
    const pageSize = Math.min(
      Math.max(options.pageSize ?? CodeDiffService.PAGE_SIZE, 1),
      CodeDiffService.PAGE_SIZE,
    );
    const page = Math.max(options.page ?? 0, 0);
    const slice = result.changes.slice(page * pageSize, (page + 1) * pageSize);
    const files: DiffFile[] = [];
    let eagerFiles = 0;
    let eagerBytes = 0;
    for (const change of slice) {
      const entry = this.entryOf(change);
      if (
        entry.status === "pending" &&
        !entry.generated &&
        eagerFiles < CodeDiffService.EAGER_FILES &&
        eagerBytes < CodeDiffService.EAGER_BYTES
      ) {
        const loaded = await this.hunksOf(ref, entry);
        eagerFiles += 1;
        eagerBytes += loaded.bytes;
        files.push(loaded.file);
      } else {
        files.push(entry);
      }
    }
    return {
      from,
      to,
      files,
      total: result.changes.length,
      page,
      pageSize,
      partial: result.partial,
    };
  }

  /**
   * One file's hunks, by its path in `to` (or in `from` for a deletion).
   */
  public async file(
    ref: string,
    from: string | undefined,
    to: string,
    path: string,
  ): Promise<DiffFile | undefined> {
    const [fromTree, toTree] = await this.treesOf(ref, from, to);
    const result = await this.treeDiff.diff(ref, fromTree, toTree, {
      maxChanges: CodeDiffService.MAX_FILES,
    });
    const change = result.changes.find((it) => it.path === path);
    if (!change) return undefined;
    return (await this.hunksOf(ref, this.entryOf(change))).file;
  }

  /**
   * Lines `start` to `end` (1-based, inclusive) of a blob, for "show more
   * context" between two hunks.
   */
  public async lines(
    ref: string,
    blobSha: string,
    start: number,
    end: number,
  ): Promise<string[] | undefined> {
    const read = await this.backend.blob(ref, blobSha, {
      maxBytes: CodeDiffService.MAX_BLOB_BYTES,
    });
    if (read.kind !== "ok" || read.binary) return undefined;
    const lines = CodeDiffService.split(new TextDecoder().decode(read.bytes));
    return lines.lines.slice(Math.max(start - 1, 0), Math.max(end, 0));
  }

  protected async treesOf(
    ref: string,
    from: string | undefined,
    to: string,
  ): Promise<[string | undefined, string | undefined]> {
    const [a, b] = await Promise.all([
      from ? this.backend.commit(ref, from) : undefined,
      this.backend.commit(ref, to),
    ]);
    return [a?.treeSha, b?.treeSha];
  }

  /**
   * A change as the file list shows it, before any blob is read.
   */
  protected entryOf(change: GitTreeChange): DiffFile {
    const generated = CodeDiffService.GENERATED.some((pattern) =>
      pattern.test(change.path),
    );
    return {
      path: change.path,
      oldPath: change.oldPath,
      kind: change.kind,
      oldMode: change.oldMode,
      newMode: change.newMode,
      oldSha: change.oldBlobSha,
      newSha: change.newBlobSha,
      generated,
      submodule: Boolean(change.submodule),
      status: change.submodule
        ? "submodule"
        : change.kind === "renamed" && change.oldBlobSha === change.newBlobSha
          ? "loaded"
          : generated
            ? "collapsed"
            : "pending",
      ...(change.kind === "renamed" && change.oldBlobSha === change.newBlobSha
        ? { additions: 0, deletions: 0, hunks: [] }
        : {}),
    };
  }

  /**
   * Read both sides and diff them. Answers the file and the bytes read,
   * which count against the eager budget.
   */
  protected async hunksOf(
    ref: string,
    entry: DiffFile,
  ): Promise<{ file: DiffFile; bytes: number }> {
    if (entry.submodule) return { file: entry, bytes: 0 };
    const read = async (sha: string | undefined) =>
      sha
        ? this.backend.blob(ref, sha, {
            maxBytes: CodeDiffService.MAX_BLOB_BYTES,
          })
        : ({
            kind: "ok",
            bytes: new Uint8Array(0),
            size: 0,
            binary: false,
          } as const);
    const [before, after] = await Promise.all([
      read(entry.oldSha),
      read(entry.newSha),
    ]);
    if (before.kind === "too_large" || after.kind === "too_large") {
      return { file: { ...entry, status: "too_large" }, bytes: 0 };
    }
    if (before.kind !== "ok" || after.kind !== "ok") {
      return { file: { ...entry, status: "too_large" }, bytes: 0 };
    }
    const bytes = before.size + after.size;
    if (before.binary || after.binary) {
      return { file: { ...entry, status: "binary" }, bytes };
    }
    const decoder = new TextDecoder();
    const a = CodeDiffService.split(decoder.decode(before.bytes));
    const b = CodeDiffService.split(decoder.decode(after.bytes));
    if (
      a.lines.length > CodeDiffService.MAX_LINES ||
      b.lines.length > CodeDiffService.MAX_LINES
    ) {
      return { file: { ...entry, status: "too_large" }, bytes };
    }
    const ops = LineDiff.diff(a.keys, b.keys);
    if (!ops) return { file: { ...entry, status: "too_large" }, bytes };
    let additions = 0;
    let deletions = 0;
    const hunks = LineDiff.hunks(ops).map((hunk) => ({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.ops.map((op): DiffLine => {
        if (op.kind === "insert") {
          additions += 1;
          return this.line(entry.path, "add", undefined, op.b + 1, b, op.b);
        }
        if (op.kind === "delete") {
          deletions += 1;
          return this.line(
            entry.oldPath ?? entry.path,
            "del",
            op.a + 1,
            undefined,
            a,
            op.a,
          );
        }
        return this.line(entry.path, "context", op.a + 1, op.b + 1, b, op.b);
      }),
    }));
    return {
      file: {
        ...entry,
        status: "loaded",
        additions,
        deletions,
        hunks,
        oldLineCount: a.lines.length,
        newLineCount: b.lines.length,
      },
      bytes,
    };
  }

  protected line(
    path: string,
    kind: DiffLine["kind"],
    oldLine: number | undefined,
    newLine: number | undefined,
    side: { lines: string[]; noNewline: boolean },
    index: number,
  ): DiffLine {
    const anchor =
      kind === "del" ? `${path}:old:${oldLine}` : `${path}:new:${newLine}`;
    return {
      kind,
      oldLine,
      newLine,
      text: side.lines[index] ?? "",
      anchor,
      ...(side.noNewline && index === side.lines.length - 1
        ? { noNewline: true }
        : {}),
    };
  }

  /**
   * A file's lines, the trailing newline not making one more, and the keys
   * the diff compares: a last line without its newline differs from the
   * same text with one, as git says "No newline at end of file".
   */
  public static split(text: string): {
    lines: string[];
    keys: string[];
    noNewline: boolean;
  } {
    if (text === "") return { lines: [], keys: [], noNewline: false };
    const noNewline = !text.endsWith("\n");
    const lines = (noNewline ? text : text.slice(0, -1)).split("\n");
    const keys = noNewline
      ? [...lines.slice(0, -1), `${lines[lines.length - 1]}\u0000`]
      : lines;
    return { lines, keys, noNewline };
  }
}
