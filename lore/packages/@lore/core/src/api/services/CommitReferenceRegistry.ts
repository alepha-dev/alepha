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
 *
 * And the other way (#Q4136): Build's commit pages ask which quests a
 * commit landed on, through {@link CommitReferenceRegistry.questsForCommits},
 * which Plan answers from every quest's commit trail (a push's and a
 * `quest_commit_add`'s alike), never by reading a message again.
 */
export class CommitReferenceRegistry {
  protected recorder?: CommitReferenceRecorder;
  protected reader?: CommitQuestReader;
  protected landings: CommitLandingHandler[] = [];

  /**
   * What hears a commit reach the default branch (#Q4234): Plan, which
   * completes the quests an automation built that the commit's history
   * names.
   */
  public registerLanding(handler: CommitLandingHandler): void {
    this.landings.push(handler);
  }

  /**
   * A commit reached the project's default branch, with every quest its
   * history names (its whole-history set). Ship calls it after a push of
   * that branch recorded the set.
   */
  public async landed(input: CommitLanding): Promise<void> {
    for (const handler of this.landings) {
      await handler(input);
    }
  }

  public register(recorder: CommitReferenceRecorder): void {
    if (this.recorder) {
      throw new AlephaError(
        "A commit reference recorder is already registered",
      );
    }
    this.recorder = recorder;
  }

  public registerReader(reader: CommitQuestReader): void {
    if (this.reader) {
      throw new AlephaError("A commit quest reader is already registered");
    }
    this.reader = reader;
  }

  /**
   * The quests each full sha landed on, matched by prefix against the
   * quests' trails (7 to 40 characters): an empty list for a sha on none,
   * and for every sha without Plan.
   */
  public async questsForCommits(
    projectId: number,
    shas: string[],
  ): Promise<Map<string, CommitQuest[]>> {
    if (!this.reader || shas.length === 0) {
      return new Map(shas.map((sha) => [sha, []]));
    }
    return this.reader(projectId, shas);
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

/**
 * A commit of the default branch and the quests its history names.
 */
export interface CommitLanding {
  projectId: number;
  commitSha: string;
  branch: string;
  numbers: number[];
}

export type CommitLandingHandler = (landing: CommitLanding) => Promise<void>;

export type CommitQuestReader = (
  projectId: number,
  shas: string[],
) => Promise<Map<string, CommitQuest[]>>;

/**
 * A quest a commit landed on, as a commit page lists it.
 */
export interface CommitQuest {
  number: number;
  title: string;
  status: string;
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
