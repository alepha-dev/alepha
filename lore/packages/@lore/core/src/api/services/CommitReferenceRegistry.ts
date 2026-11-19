import { AlephaError } from "alepha";

/**
 * Commits that name a quest (#Q3945): a push to a Lore repository records
 * each new commit whose message names `#Q<n>` on that quest.
 *
 * Repositories are Build's and quests Plan's, and neither may import the
 * other, so they meet here, on {@link LiveQuestRegistry}'s pattern:
 *
 * - **Plan registers the recorder**: it reads the references, finds the
 *   quests and appends the commits to their trail.
 * - **Build calls it** after a push the backend accepted.
 *
 * Without Plan it records nothing, and says so: zero.
 */
export class CommitReferenceRegistry {
  protected recorder?: CommitReferenceRecorder;

  public register(recorder: CommitReferenceRecorder): void {
    if (this.recorder) {
      throw new AlephaError(
        "A commit reference recorder is already registered",
      );
    }
    this.recorder = recorder;
  }

  /**
   * Record the commits on the quests they name. Answers what was recorded.
   */
  public async record(
    input: CommitReferenceInput,
  ): Promise<CommitReferenceResult> {
    if (!this.recorder || input.commits.length === 0) {
      return { quests: [], commits: 0 };
    }
    return this.recorder(input);
  }
}

export type CommitReferenceRecorder = (
  input: CommitReferenceInput,
) => Promise<CommitReferenceResult>;

export interface CommitReferenceInput {
  projectId: number;
  /**
   * Who pushed: the commit is recorded `by` them.
   */
  userId: string;
  /**
   * Free text for the trail, e.g. the repository's clone path.
   */
  repo?: string;
  commits: Array<{ sha: string; message: string }>;
}

export interface CommitReferenceResult {
  /**
   * The quest numbers that gained at least one commit.
   */
  quests: number[];
  /**
   * How many (quest, commit) pairs were added.
   */
  commits: number;
}
