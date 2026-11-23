import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { GitBackend } from "../backends/GitBackend.ts";
import {
  type CodeBlameCacheRow,
  codeBlameCache,
} from "../entities/codeBlameCache.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";
import { CodeDiffService } from "./CodeDiffService.ts";
import { LineDiff } from "./LineDiff.ts";

/**
 * Blame from the commit index (#Q4138, folio #F1540: the same on both
 * backends, Artifacts having none): which commit each line of a file at a
 * commit came from.
 *
 * ## The walk
 *
 * A **suspect** is a version of the file (its blob, its path) somewhere at or
 * behind a commit, with the lines still unattributed. Its **producer** is the
 * commit that wrote that blob at that path, found in `code_commit_paths`
 * (`newBlobSha`), reachable from where the suspect stands. Then:
 *
 * - A parent holding the very same blob (a merge that took one side whole,
 *   an exact rename) gets every line, and the producer none, as `git blame`
 *   passes them through.
 * - Otherwise each parent's version is diffed with the suspect's
 *   ({@link LineDiff}): a line unchanged against a parent is that parent's
 *   (the first parent first), a line in no parent is the producer's.
 * - A file the producer added has no parent version: every line left is its.
 *
 * A step is one producer. A cached blame of a parent at the same path is
 * read instead of walked.
 *
 * ## Caps
 *
 * {@link CodeBlameService.MAX_BYTES} and {@link CodeBlameService.MAX_LINES}
 * answer `too_large`. {@link CodeBlameService.INLINE_STEPS} steps run in the
 * request; past them the result is `pending` and `code.blame` finishes the
 * walk, up to {@link CodeBlameService.MAX_STEPS}, after which the lines left
 * are "older than" where it stopped (`partial`).
 */
export class CodeBlameService {
  public static readonly MAX_BYTES = 256 * 1024;
  public static readonly MAX_LINES = 5000;
  public static readonly INLINE_STEPS = 25;
  public static readonly MAX_STEPS = 200;

  protected readonly log = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly cache = $repository(codeBlameCache);

  /**
   * The cached blame, or a new walk of `INLINE_STEPS` (a `pending` row the
   * job resumes when it did not finish). Answers the row, or why there is
   * none: the file, too large, or not indexed yet.
   */
  public async blame(
    repository: CodeRepository,
    commitSha: string,
    path: string,
  ): Promise<
    | { kind: "row"; row: CodeBlameCacheRow; text: string }
    | { kind: "too_large" | "not_found" | "indexing" }
  > {
    const file = await this.backend.file(
      repository.backendRef,
      commitSha,
      path,
      { maxBytes: CodeBlameService.MAX_BYTES },
    );
    if (file.kind === "not_found") return { kind: "not_found" };
    if (file.kind === "too_large" || file.binary) return { kind: "too_large" };
    const text = new TextDecoder().decode(file.bytes);
    const lines = CodeDiffService.split(text).lines;
    if (lines.length > CodeBlameService.MAX_LINES) return { kind: "too_large" };

    const cached = await this.find(repository.id, commitSha, path);
    if (cached) return { kind: "row", row: cached, text };
    if (!(await this.index.find(repository.id, commitSha))) {
      return { kind: "indexing" };
    }
    const blob = await this.blobAt(repository, commitSha, path);
    if (!blob) return { kind: "not_found" };
    const state: BlameState = {
      queue: [
        {
          blob,
          path,
          from: commitSha,
          lines: lines.map((_, index) => index),
          finals: lines.map((_, index) => index),
        },
      ],
      result: lines.map(() => null),
      steps: 0,
    };
    await this.run(repository, state, CodeBlameService.INLINE_STEPS);
    const row = await this.save(repository, commitSha, path, state);
    return { kind: "row", row, text };
  }

  /**
   * Resume a `pending` walk to its end or its cap: what `code.blame` runs.
   */
  public async resume(
    repository: CodeRepository,
    row: CodeBlameCacheRow,
  ): Promise<CodeBlameCacheRow> {
    if (row.status !== "pending" || !row.state) return row;
    const state = JSON.parse(row.state) as BlameState;
    await this.run(repository, state, CodeBlameService.MAX_STEPS);
    return this.save(repository, row.commitSha, row.path, state);
  }

  public async find(
    repositoryId: string,
    commitSha: string,
    path: string,
  ): Promise<CodeBlameCacheRow | undefined> {
    return (
      (await this.cache.findOne({
        where: {
          repositoryId: { eq: repositoryId },
          commitSha: { eq: commitSha },
          path: { eq: path },
        },
      })) ?? undefined
    );
  }

  public async deleteFor(repositoryId: string): Promise<void> {
    await this.cache.deleteMany({ repositoryId: { eq: repositoryId } });
  }

  /**
   * Run the queue until it is empty or `limit` steps have run in all.
   */
  protected async run(
    repository: CodeRepository,
    state: BlameState,
    limit: number,
  ): Promise<void> {
    const texts = new Map<string, string[] | undefined>();
    while (state.queue.length > 0 && state.steps < limit) {
      const suspect = state.queue.shift()!;
      await this.step(repository, state, suspect, texts);
    }
  }

  protected async step(
    repository: CodeRepository,
    state: BlameState,
    suspect: BlameSuspect,
    texts: Map<string, string[] | undefined>,
  ): Promise<void> {
    // A parent's blame already kept: its lines, as they are.
    const known = await this.find(repository.id, suspect.from, suspect.path);
    if (known && known.status === "ready") {
      for (let i = 0; i < suspect.lines.length; i++) {
        const range = known.ranges.find(
          (it) =>
            suspect.lines[i]! + 1 >= it.startLine &&
            suspect.lines[i]! + 1 <= it.endLine,
        );
        if (range?.commitSha) {
          state.result[suspect.finals[i]!] = {
            sha: range.commitSha,
            path: range.originalPath ?? suspect.path,
          };
        }
      }
      return;
    }

    state.steps += 1;
    const producer = await this.producer(repository, suspect);
    if (!producer) {
      // Not indexed that far, or a history the index does not hold.
      state.stoppedAt ??= suspect.from;
      return;
    }
    const commit = await this.index.find(repository.id, producer.commitSha);
    const parents = commit?.parents ?? [];
    const versions: Array<{ blob: string; path: string; from: string }> = [];
    if (producer.oldBlobSha && parents[0]) {
      versions.push({
        blob: producer.oldBlobSha,
        path: producer.oldPath ?? suspect.path,
        from: parents[0],
      });
    }
    for (const parent of parents.slice(1)) {
      const blob = await this.blobAt(
        repository,
        parent,
        producer.oldPath ?? suspect.path,
      );
      if (blob) {
        versions.push({
          blob,
          path: producer.oldPath ?? suspect.path,
          from: parent,
        });
      }
    }

    // A parent with the same bytes takes every line: nothing changed here.
    const same = versions.find((it) => it.blob === suspect.blob);
    if (same) {
      state.queue.push({ ...suspect, ...same });
      return;
    }

    const current = await this.textOf(repository, suspect.blob, texts);
    const left = new Set(suspect.lines.map((_, index) => index));
    for (const version of versions) {
      if (left.size === 0) break;
      const old = await this.textOf(repository, version.blob, texts);
      if (!current || !old) continue;
      const ops = LineDiff.diff(old, current);
      if (!ops) continue;
      const toOld = new Map<number, number>();
      for (const op of ops) {
        if (op.kind === "equal") toOld.set(op.b, op.a);
      }
      const lines: number[] = [];
      const finals: number[] = [];
      // Deleting the entry being visited is safe in a Set's iteration.
      for (const index of left) {
        const mapped = toOld.get(suspect.lines[index]!);
        if (mapped === undefined) continue;
        lines.push(mapped);
        finals.push(suspect.finals[index]!);
        left.delete(index);
      }
      if (lines.length > 0) state.queue.push({ ...version, lines, finals });
    }
    for (const index of left) {
      state.result[suspect.finals[index]!] = {
        sha: producer.commitSha,
        path: suspect.path,
      };
    }
  }

  /**
   * The commit that wrote `blob` at `path`, the newest of those reachable
   * from where the suspect stands. Content is addressed, so there is nearly
   * always one candidate and no reachability query.
   */
  protected async producer(repository: CodeRepository, suspect: BlameSuspect) {
    const rows = (
      await this.index.producers(repository.id, suspect.path, suspect.blob)
    ).filter((row) => row.kind !== "deleted");
    if (rows.length <= 1) return rows[0];
    const commits = new Map(
      (
        await this.index.many(
          repository.id,
          rows.map((row) => row.commitSha),
        )
      ).map((row) => [row.sha, row]),
    );
    const ordered = rows.sort(
      (a, b) =>
        (commits.get(b.commitSha)?.committedAt ?? 0) -
        (commits.get(a.commitSha)?.committedAt ?? 0),
    );
    for (const row of ordered) {
      if (
        await this.index.reaches(repository.id, suspect.from, row.commitSha)
      ) {
        return row;
      }
    }
    return undefined;
  }

  /**
   * The blob at `path` in `commit`, or undefined.
   */
  protected async blobAt(
    repository: CodeRepository,
    commit: string,
    path: string,
  ): Promise<string | undefined> {
    const at = path.lastIndexOf("/");
    const entries = await this.backend.tree(
      repository.backendRef,
      commit,
      at === -1 ? "" : path.slice(0, at),
    );
    return entries?.find(
      (it) => it.name === path.slice(at + 1) && it.type === "blob",
    )?.sha;
  }

  protected async textOf(
    repository: CodeRepository,
    blob: string,
    texts: Map<string, string[] | undefined>,
  ): Promise<string[] | undefined> {
    if (texts.has(blob)) return texts.get(blob);
    const read = await this.backend.blob(repository.backendRef, blob, {
      maxBytes: CodeBlameService.MAX_BYTES,
    });
    const lines =
      read.kind === "ok" && !read.binary
        ? CodeDiffService.split(new TextDecoder().decode(read.bytes)).keys
        : undefined;
    if (texts.size > 200) texts.clear();
    texts.set(blob, lines);
    return lines;
  }

  /**
   * The state as the cache row: `ready` once the queue is empty, `partial`
   * at the cap, `pending` with the queue kept otherwise.
   */
  protected async save(
    repository: CodeRepository,
    commitSha: string,
    path: string,
    state: BlameState,
  ): Promise<CodeBlameCacheRow> {
    const done = state.queue.length === 0;
    const capped = !done && state.steps >= CodeBlameService.MAX_STEPS;
    if (capped) {
      state.stoppedAt ??= state.queue[0]?.from;
    }
    const status: CodeBlameCacheRow["status"] = done
      ? state.stoppedAt
        ? "partial"
        : "ready"
      : capped
        ? "partial"
        : "pending";
    const values = {
      repositoryId: repository.id,
      commitSha,
      path,
      status,
      ranges: CodeBlameService.ranges(state.result),
      stoppedAtSha: status === "partial" ? state.stoppedAt : undefined,
      steps: state.steps,
      state: status === "pending" ? JSON.stringify(state) : undefined,
    };
    const existing = await this.find(repository.id, commitSha, path);
    if (existing) {
      return this.cache.updateById(existing.id, {
        ...values,
        stoppedAtSha: values.stoppedAtSha ?? null,
        state: values.state ?? null,
      } as never);
    }
    return this.cache.create(values);
  }

  /**
   * Per-line attributions as runs of one commit, 1-based; an unattributed
   * run has no `commitSha`.
   */
  public static ranges(
    result: Array<{ sha: string; path: string } | null>,
  ): CodeBlameCacheRow["ranges"] {
    const ranges: CodeBlameCacheRow["ranges"] = [];
    result.forEach((line, index) => {
      const last = ranges[ranges.length - 1];
      if (
        last &&
        last.commitSha === line?.sha &&
        last.originalPath === line?.path
      ) {
        last.endLine = index + 1;
        return;
      }
      ranges.push({
        startLine: index + 1,
        endLine: index + 1,
        commitSha: line?.sha,
        originalPath: line?.path,
      });
    });
    return ranges;
  }
}

/**
 * A version of the file still owed lines: its blob at `path`, found at or
 * behind `from`. `lines[i]` is a line of this version (0-based), owed to
 * the final file's line `finals[i]`.
 */
export interface BlameSuspect {
  blob: string;
  path: string;
  from: string;
  lines: number[];
  finals: number[];
}

export interface BlameState {
  queue: BlameSuspect[];
  result: Array<{ sha: string; path: string } | null>;
  steps: number;
  stoppedAt?: string;
}
