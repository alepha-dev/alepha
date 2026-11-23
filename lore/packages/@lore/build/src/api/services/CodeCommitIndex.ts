import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";

import {
  GitBackend,
  type GitCommitDetail,
  type GitTreeEntry,
} from "../backends/GitBackend.ts";
import { codeCommitParents } from "../entities/codeCommitParents.ts";
import { codeCommitPaths } from "../entities/codeCommitPaths.ts";
import { type CodeCommitRow, codeCommits } from "../entities/codeCommits.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { GitTreeDiff } from "./GitTreeDiff.ts";

/**
 * Lore's commit index (#Q4132): what a repository's commits are, which
 * paths each changed, and which parents each has, in SQL, on both backends.
 *
 * ## Writing
 *
 * {@link CodeCommitIndex.walk} reads commits from some tips back through
 * EVERY parent (`GitBackend.commit`, not Artifacts' first-parent `log`),
 * stopping at a commit already indexed, at most `budget` of them. Each
 * commit writes its paths and its parent edges, then its `code_commits`
 * row: the row is the proof the commit is complete.
 *
 * What a walk leaves behind is the **frontier**, derived rather than
 * stored: a parent edge no `code_commits` row answers. The backfill job
 * (`CodeIndexJobs`) seeds from the frontier and the unindexed branch and
 * tag tips, so it resumes where any walk stopped, a push's included.
 *
 * ## Reading
 *
 * {@link CodeCommitIndex.log}: the commits reachable from a commit (a
 * recursive CTE over `code_commit_parents`, the same SQL on D1 and on
 * Postgres), newest first, optionally only those that touched a file or a
 * folder. Reachability is what keeps a branch's history its own: a commit
 * of another branch, an orphan a force-push left, or one newer than a tag is
 * never listed.
 */
export class CodeCommitIndex {
  /**
   * The most commits a push indexes before the git route answers; a larger
   * push leaves the rest to the backfill job.
   */
  public static readonly PUSH_INLINE = 50;

  /**
   * The most commits one run of the backfill job indexes. On the Worker each
   * commit costs a `readCommit` and a `readTree` per changed directory, and
   * an invocation has a budget of subrequests.
   */
  public static readonly CHUNK = 40;

  /**
   * The most rows a log page answers.
   */
  public static readonly MAX_PAGE = 100;

  protected static readonly FrontierRow = z.object({ sha: z.string() });

  protected static readonly LogRow = codeCommits.schema.extend({
    parents: z.union([z.string(), z.array(z.string())]),
  });

  protected readonly log_ = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly treeDiff = $inject(GitTreeDiff);
  protected readonly commits = $repository(codeCommits);
  protected readonly parents = $repository(codeCommitParents);
  protected readonly paths = $repository(codeCommitPaths);

  /**
   * The shas of `shas` the index holds, asked 50 at a time: D1 binds at
   * most 100 values per statement.
   */
  public async known(
    repositoryId: string,
    shas: string[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    const unique = [...new Set(shas)];
    for (let i = 0; i < unique.length; i += 50) {
      const rows = await this.commits.findMany({
        where: {
          repositoryId: { eq: repositoryId },
          sha: { inArray: unique.slice(i, i + 50) },
        },
        columns: ["sha"],
      });
      for (const row of rows) found.add(row.sha);
    }
    return found;
  }

  /**
   * One indexed commit, or undefined.
   */
  public async find(
    repositoryId: string,
    sha: string,
  ): Promise<CodeCommitRow | undefined> {
    return (
      (await this.commits.findOne({
        where: { repositoryId: { eq: repositoryId }, sha: { eq: sha } },
      })) ?? undefined
    );
  }

  /**
   * The commits the index holds whose sha starts with `prefix` (7 to 39
   * hex characters), at most two: a unique prefix resolves, two are
   * ambiguous.
   */
  public async byPrefix(
    repositoryId: string,
    prefix: string,
  ): Promise<string[]> {
    if (!/^[0-9a-f]{7,39}$/.test(prefix)) return [];
    const rows = await this.commits.findMany({
      where: {
        repositoryId: { eq: repositoryId },
        sha: { gte: prefix, lt: `${prefix}g` },
      },
      limit: 2,
    });
    return rows.map((row) => row.sha);
  }

  /**
   * Parents of indexed commits that are not indexed themselves: where the
   * last walk stopped.
   */
  public async frontier(repositoryId: string, limit = 100): Promise<string[]> {
    const p = this.parents.table;
    const c = this.commits.table;
    const col = (name: string) => sql.identifier(name);
    const rows = await this.parents.query(
      sql`SELECT DISTINCT ${col(p.parentSha.name)} AS sha FROM ${p}
        WHERE ${col(p.repositoryId.name)} = ${repositoryId}
        AND NOT EXISTS (
          SELECT 1 FROM ${c} AS x
          WHERE x.${col(c.repositoryId.name)} = ${repositoryId}
          AND x.${col(c.sha.name)} = ${p}.${col(p.parentSha.name)}
        )
        LIMIT ${limit}`,
      CodeCommitIndex.FrontierRow,
    );
    return rows.map((row) => row.sha);
  }

  /**
   * Index the commits reachable from `seeds` that the index lacks, at most
   * `budget` of them, newest-discovered first. Answers how many it wrote
   * and whether any are left (the frontier, or a seed it did not reach).
   */
  public async walk(
    repository: CodeRepository,
    seeds: string[],
    budget: number,
  ): Promise<{ indexed: number; remaining: boolean }> {
    const ref = repository.backendRef;
    const details = new Map<string, GitCommitDetail>();
    const trees = new Map<string, GitTreeEntry[]>();
    const read = async (sha: string) => {
      const known = details.get(sha);
      if (known) return known;
      const detail = await this.backend.commit(ref, sha);
      if (detail) {
        if (details.size > 500) details.clear();
        details.set(sha, detail);
      }
      return detail;
    };

    const unique = [...new Set(seeds.filter((sha) => GitBackend.isSha(sha)))];
    const indexedAlready = await this.known(repository.id, unique);
    const queue = unique.filter((sha) => !indexedAlready.has(sha));
    const seen = new Set<string>();
    let indexed = 0;
    while (queue.length > 0 && indexed < budget) {
      const sha = queue.shift()!;
      if (seen.has(sha)) continue;
      seen.add(sha);
      const detail = await read(sha);
      if (!detail) continue;
      await this.write(repository, detail, read, trees);
      indexed += 1;
      const missing = await this.known(repository.id, detail.parents);
      for (const parent of detail.parents) {
        if (!missing.has(parent) && !seen.has(parent)) queue.push(parent);
      }
    }
    const remaining =
      queue.some((sha) => !seen.has(sha)) ||
      (await this.frontier(repository.id, 1)).length > 0;
    return { indexed, remaining };
  }

  /**
   * One commit's rows: its paths and edges first, its `code_commits` row
   * last. Rewriting a commit replaces its paths and edges, so a commit a
   * crash left half-written is whole after the next walk.
   */
  protected async write(
    repository: CodeRepository,
    detail: GitCommitDetail,
    read: (sha: string) => Promise<GitCommitDetail | undefined>,
    trees: Map<string, GitTreeEntry[]>,
  ): Promise<void> {
    const ref = repository.backendRef;
    const first = detail.parents[0] ? await read(detail.parents[0]) : undefined;
    const main = await this.treeDiff.diff(ref, first?.treeSha, detail.treeSha, {
      cache: trees,
    });
    let changes = main.changes;
    // A merge keeps the paths it changed against every parent.
    for (const parentSha of detail.parents.slice(1)) {
      const parent = await read(parentSha);
      const other = await this.treeDiff.diff(
        ref,
        parent?.treeSha,
        detail.treeSha,
        { cache: trees },
      );
      const touched = new Set(other.changes.map((change) => change.path));
      changes = changes.filter((change) => touched.has(change.path));
    }
    if (main.partial) {
      this.log_.warn("A commit's paths were cut at the tree diff's cap", {
        repository: repository.id,
        sha: detail.sha,
      });
    }

    const where = {
      repositoryId: { eq: repository.id },
      commitSha: { eq: detail.sha },
    };
    await this.paths.deleteMany(where);
    if (changes.length > 0) {
      await this.paths.createMany(
        changes.map((change) => ({
          repositoryId: repository.id,
          commitSha: detail.sha,
          path: change.path,
          oldPath: change.oldPath,
          kind: change.kind,
          oldBlobSha: change.oldBlobSha,
          newBlobSha: change.newBlobSha,
        })),
      );
    }
    await this.parents.deleteMany({
      repositoryId: { eq: repository.id },
      sha: { eq: detail.sha },
    });
    if (detail.parents.length > 0) {
      await this.parents.createMany(
        detail.parents.map((parentSha, position) => ({
          repositoryId: repository.id,
          sha: detail.sha,
          parentSha,
          position,
        })),
      );
    }
    try {
      await this.commits.create({
        repositoryId: repository.id,
        sha: detail.sha,
        firstParent: detail.parents[0],
        parents: detail.parents,
        treeSha: detail.treeSha,
        authorName: detail.author.name,
        authorEmail: detail.author.email,
        authoredAt: detail.author.at,
        committerName: detail.committer.name,
        committerEmail: detail.committer.email,
        committedAt: detail.committer.at,
        subject: detail.subject,
        body: detail.body,
      });
    } catch (error) {
      // Another walk (a push beside the backfill) wrote it first.
      if (!(await this.find(repository.id, detail.sha))) throw error;
    }
  }

  /**
   * The commits reachable from `tip`, newest first, `limit` from `offset`,
   * optionally only those that touched `path`: the file itself, anything
   * under it when it is a folder, or a rename away from it.
   */
  public async log(
    repositoryId: string,
    tip: string,
    options: { path?: string; offset?: number; limit?: number } = {},
  ): Promise<{ commits: CodeCommitRow[]; more: boolean }> {
    const limit = Math.min(
      Math.max(options.limit ?? 30, 1),
      CodeCommitIndex.MAX_PAGE,
    );
    const offset = Math.max(options.offset ?? 0, 0);
    const p = this.parents.table;
    const c = this.commits.table;
    const x = this.paths.table;
    const col = (name: string) => sql.identifier(name);
    const path = options.path?.replace(/^\/+|\/+$/g, "");
    const touched = path
      ? sql`AND EXISTS (
          SELECT 1 FROM ${x} AS t
          WHERE t.${col(x.repositoryId.name)} = ${repositoryId}
          AND t.${col(x.commitSha.name)} = c.${col(c.sha.name)}
          AND (
            t.${col(x.path.name)} = ${path}
            OR (t.${col(x.path.name)} >= ${`${path}/`} AND t.${col(x.path.name)} < ${`${path}0`})
            OR t.${col(x.oldPath.name)} = ${path}
          )
        )`
      : sql``;
    const rows = await this.commits.query(
      sql`WITH RECURSIVE reach(sha) AS (
          SELECT ${tip}
          UNION
          SELECT e.${col(p.parentSha.name)} FROM ${p} AS e
          JOIN reach ON e.${col(p.sha.name)} = reach.sha
          WHERE e.${col(p.repositoryId.name)} = ${repositoryId}
        )
        SELECT c.* FROM ${c} AS c
        JOIN reach ON c.${col(c.sha.name)} = reach.sha
        WHERE c.${col(c.repositoryId.name)} = ${repositoryId}
        ${touched}
        ORDER BY c.${col(c.committedAt.name)} DESC, c.${col(c.sha.name)}
        LIMIT ${limit + 1} OFFSET ${offset}`,
      CodeCommitIndex.LogRow,
    );
    // A raw read hands the JSON column back as text on SQLite.
    const commits = rows.slice(0, limit).map((row) => ({
      ...row,
      parents:
        typeof row.parents === "string"
          ? (JSON.parse(row.parents) as string[])
          : row.parents,
    }));
    return { commits, more: rows.length > limit };
  }

  /**
   * Every index row of a repository, gone: before its `code_repositories`
   * row, whose foreign keys restrict.
   */
  public async deleteFor(repositoryId: string): Promise<void> {
    const where = { repositoryId: { eq: repositoryId } };
    await this.paths.deleteMany(where);
    await this.parents.deleteMany(where);
    await this.commits.deleteMany(where);
  }
}
