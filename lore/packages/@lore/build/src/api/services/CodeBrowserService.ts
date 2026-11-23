import { $inject, type Infer } from "alepha";

import { GitBackend, type GitRefTip } from "../backends/GitBackend.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeIndexJobs } from "../jobs/CodeIndexJobs.ts";
import type { codeCommitSummarySchema } from "../schemas/codeCommitSummarySchema.ts";
import type { codeRefSchema } from "../schemas/codeRefSchema.ts";
import type { codeRepositoryDetailSchema } from "../schemas/codeRepositoryDetailSchema.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";
import { CodeRepositoryService } from "./CodeRepositoryService.ts";

type CommitSummary = Infer<typeof codeCommitSummarySchema>;
type Ref = Infer<typeof codeRefSchema>;

/**
 * What the code browser reads of a repository (#E167), over the backend and
 * the commit index, for the pages and the `code_*` tools alike.
 */
export class CodeBrowserService {
  protected readonly backend = $inject(GitBackend);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly indexJobs = $inject(CodeIndexJobs);
  protected readonly repositories = $inject(CodeRepositoryService);

  /**
   * One commit's summary: the index's row, or the backend's commit while
   * the index has not reached it.
   */
  public async summary(
    repository: CodeRepository,
    sha: string,
  ): Promise<CommitSummary | undefined> {
    const row = await this.index.find(repository.id, sha);
    if (row) {
      return {
        sha: row.sha,
        subject: row.subject,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        authoredAt: row.authoredAt,
        committedAt: row.committedAt,
        parents: row.parents,
      };
    }
    const commit = await this.backend.commit(repository.backendRef, sha);
    if (!commit) return undefined;
    return {
      sha: commit.sha,
      subject: commit.subject,
      authorName: commit.author.name,
      authorEmail: commit.author.email,
      authoredAt: commit.author.at,
      committedAt: commit.committer.at,
      parents: commit.parents,
    };
  }

  /**
   * Branches and tags, short-named and sorted, a tag peeled to its commit.
   */
  public refsOf(tips: GitRefTip[]): { branches: Ref[]; tags: Ref[] } {
    const pick = (prefix: string) =>
      tips
        .filter((tip) => tip.name.startsWith(prefix))
        .map((tip) => ({
          name: tip.name.slice(prefix.length),
          sha: tip.targetSha ?? tip.sha,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { branches: pick("refs/heads/"), tags: pick("refs/tags/") };
  }

  /**
   * The default branch's last commit, or undefined on an empty repository.
   */
  public async head(
    repository: CodeRepository,
  ): Promise<CommitSummary | undefined> {
    const sha = await this.backend.resolve(
      repository.backendRef,
      repository.defaultBranch,
    );
    return sha ? this.summary(repository, sha) : undefined;
  }

  /**
   * The repository page's header. Opening it starts the backfill when the
   * index lacks the default branch's tip: a repository from before the
   * index is indexed the first time anyone looks.
   */
  public async detail(
    repository: CodeRepository,
    base: string,
  ): Promise<Infer<typeof codeRepositoryDetailSchema>> {
    const tips = await this.backend.refs(repository.backendRef);
    const { branches, tags } = this.refsOf(tips);
    const tip = branches.find((it) => it.name === repository.defaultBranch);
    const indexed = tip
      ? Boolean(await this.index.find(repository.id, tip.sha))
      : true;
    if (!indexed) await this.indexJobs.start(repository.id);
    return {
      repository: await this.repositories.toResource(repository, base),
      branches,
      tags,
      head: tip ? await this.summary(repository, tip.sha) : undefined,
      indexing: !indexed,
    };
  }
}
