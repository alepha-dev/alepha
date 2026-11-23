import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { GitBackend } from "../backends/GitBackend.ts";
import {
  type CodeRepository,
  codeRepositories,
} from "../entities/codeRepositories.ts";
import { CodeCommitIndex } from "../services/CodeCommitIndex.ts";

/**
 * The commit index's backfill (#Q4132): a repository's history indexed in
 * chunks, resumable, whatever brought it (an import, a push over
 * {@link CodeCommitIndex.PUSH_INLINE}, a repository from before the index).
 *
 * - **`code.index`** (one repository): seeds from the frontier and from the
 *   branch and tag tips the index lacks, indexes
 *   {@link CodeCommitIndex.CHUNK} commits, and reschedules itself while any
 *   are left. Pushed under the key `code.index:<repositoryId>`, so a
 *   repository has one in flight at most.
 * - **`code.index-sweep`** (hourly): pushes `code.index` for every
 *   repository whose tips the index lacks, so an existing repository
 *   backfills without anyone asking, and a run that failed is picked up.
 */
export class CodeIndexJobs {
  protected readonly log = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly repositories = $repository(codeRepositories);

  public readonly indexRepository = $job({
    name: "code.index",
    description: "Indexes a git repository's commits, a chunk per run.",
    schema: z.object({ repositoryId: z.uuid() }),
    timeout: [10, "minutes"],
    retry: { retries: 3 },
    handler: async ({ payload, reschedule }) => {
      const repository = await this.repositories.findById(payload.repositoryId);
      if (!repository) return;
      const result = await this.chunk(repository);
      if (result.remaining) reschedule({ delay: [1, "second"] });
    },
  });

  public readonly sweep = $job({
    name: "code.index-sweep",
    description: "Starts the commit index of every repository behind it.",
    cron: "23 * * * *",
    timeout: [10, "minutes"],
    handler: async () => {
      const rows = await this.repositories.findMany({ limit: 10000 });
      let started = 0;
      for (const row of rows) {
        try {
          if (await this.behind(row)) {
            await this.start(row.id);
            started += 1;
          }
        } catch (error) {
          this.log.warn("A repository's index could not be checked", {
            repository: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (started)
        this.log.info(`Started the index of ${started} repositories`);
    },
  });

  /**
   * Queue the backfill of one repository, unless one is in flight already.
   */
  public async start(repositoryId: string): Promise<void> {
    await this.indexRepository.push(
      { repositoryId },
      { key: `code.index:${repositoryId}` },
    );
  }

  /**
   * One chunk of the backfill: the frontier first, then the tips.
   */
  public async chunk(repository: CodeRepository) {
    const seeds = [
      ...(await this.index.frontier(repository.id, CodeCommitIndex.CHUNK)),
      ...(await this.tips(repository)),
    ];
    return this.index.walk(repository, seeds, CodeCommitIndex.CHUNK);
  }

  /**
   * Whether the index lacks a tip or holds a frontier.
   */
  public async behind(repository: CodeRepository): Promise<boolean> {
    const tips = await this.tips(repository);
    const known = await this.index.known(repository.id, tips);
    if (tips.some((sha) => !known.has(sha))) return true;
    return (await this.index.frontier(repository.id, 1)).length > 0;
  }

  /**
   * Every branch and tag tip, an annotated tag peeled to its commit.
   */
  protected async tips(repository: CodeRepository): Promise<string[]> {
    const refs = await this.backend.refs(repository.backendRef);
    return [
      ...new Set(
        refs
          .filter((tip) => tip.name !== "HEAD")
          .map((tip) => tip.targetSha ?? tip.sha),
      ),
    ];
  }
}
