import { $inject } from "alepha";

import { GitBackend } from "../backends/GitBackend.ts";
import type { CodeCommitRow } from "../entities/codeCommits.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";

/**
 * Two commits side by side (#Q4137): their merge base, the commits `head`
 * has since it, and how far each is ahead of the other, capped. The page a
 * pull request is opened from (#E169) and its "files changed" read this,
 * which knows nothing of pull requests.
 *
 * The merge base is the backend's (`git merge-base` on disk, a capped walk
 * on Artifacts); the lists and counts are the commit index's, so they say
 * `indexing` while the index has not reached both commits.
 */
export class CodeCompareService {
  /**
   * The most commits a compare lists, and the cap of a count: past it the
   * count reads "100+".
   */
  public static readonly CAP = 100;

  protected readonly backend = $inject(GitBackend);
  protected readonly index = $inject(CodeCommitIndex);

  public async compare(
    repository: CodeRepository,
    base: string,
    head: string,
  ): Promise<CodeComparison> {
    const merge = await this.backend.mergeBase(
      repository.backendRef,
      base,
      head,
    );
    const known = await this.index.known(repository.id, [base, head]);
    const indexing = !known.has(base) || !known.has(head);
    if (indexing) {
      return {
        mergeBase: merge.kind === "ok" ? merge.sha : undefined,
        mergeBaseCapped: merge.kind === "cap",
        commits: [],
        ahead: 0,
        behind: 0,
        aheadCapped: false,
        behindCapped: false,
        indexing,
      };
    }
    const [ahead, behind] = await Promise.all([
      this.index.between(repository.id, base, head, CodeCompareService.CAP + 1),
      this.index.between(repository.id, head, base, CodeCompareService.CAP + 1),
    ]);
    return {
      mergeBase: merge.kind === "ok" ? merge.sha : undefined,
      mergeBaseCapped: merge.kind === "cap",
      commits: ahead.slice(0, CodeCompareService.CAP),
      ahead: Math.min(ahead.length, CodeCompareService.CAP),
      behind: Math.min(behind.length, CodeCompareService.CAP),
      aheadCapped: ahead.length > CodeCompareService.CAP,
      behindCapped: behind.length > CodeCompareService.CAP,
      indexing: false,
    };
  }

  /**
   * How far `head` is ahead of and behind `base`, from the index alone:
   * a branch row's counts.
   */
  public async counts(
    repository: CodeRepository,
    base: string,
    head: string,
  ): Promise<{
    ahead: number;
    behind: number;
    aheadCapped: boolean;
    behindCapped: boolean;
  }> {
    const [ahead, behind] = await Promise.all([
      this.index.between(repository.id, base, head, CodeCompareService.CAP + 1),
      this.index.between(repository.id, head, base, CodeCompareService.CAP + 1),
    ]);
    return {
      ahead: Math.min(ahead.length, CodeCompareService.CAP),
      behind: Math.min(behind.length, CodeCompareService.CAP),
      aheadCapped: ahead.length > CodeCompareService.CAP,
      behindCapped: behind.length > CodeCompareService.CAP,
    };
  }
}

export interface CodeComparison {
  /**
   * Undefined when the two share no history, or the walk ran out first
   * (`mergeBaseCapped`).
   */
  mergeBase?: string;
  mergeBaseCapped: boolean;
  /**
   * `base..head`, newest first, at most {@link CodeCompareService.CAP}.
   */
  commits: CodeCommitRow[];
  ahead: number;
  behind: number;
  aheadCapped: boolean;
  behindCapped: boolean;
  indexing: boolean;
}
