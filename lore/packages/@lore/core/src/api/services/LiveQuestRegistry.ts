import { AlephaError } from "alepha";

/**
 * Which deployed copy runs a quest's commits (#E154, folio #F1516).
 *
 * Quests are Plan's and deployments Ship's, and neither module may import the
 * other, so both register here, on {@link DeliveryChangeRegistry}'s pattern:
 *
 * - **Plan registers the recorded commits** (`quest.commits`): Ship needs them
 *   to complete a pushed commit's quest set (a quest whose recorded sha the
 *   push walked is in it) and to count what a copy is behind.
 * - **Ship registers the reads**: where a quest is live, and the live sets of
 *   a project's copies, for the quest page, the quest list and `quest_get`.
 *
 * With either module absent it answers nothing: no recorded commit, and no
 * liveness at all, which every caller reads as "unknown", never as "not live".
 */
export class LiveQuestRegistry {
  protected commits?: RecordedQuestCommitSource;
  protected reader?: LiveQuestReader;

  public registerCommits(source: RecordedQuestCommitSource): void {
    if (this.commits) {
      throw new AlephaError(
        "A recorded quest commit source is already registered",
      );
    }
    this.commits = source;
  }

  public registerReader(reader: LiveQuestReader): void {
    if (this.reader) {
      throw new AlephaError("A live quest reader is already registered");
    }
    this.reader = reader;
  }

  /**
   * Every quest of the project that has at least one recorded commit.
   */
  public async recordedCommits(
    projectId: number,
  ): Promise<RecordedQuestCommits[]> {
    return (await this.commits?.(projectId)) ?? [];
  }

  /**
   * The copies running a quest's commits. `undefined` when no reader is
   * registered: Lore cannot say, which is not the same as "nowhere".
   */
  public async whereLive(
    projectId: number,
    number: number,
  ): Promise<LiveQuestInstance[] | undefined> {
    return await this.reader?.whereLive(projectId, number);
  }

  /**
   * The live sets of every copy of the project, for a list of quests.
   * `undefined` when no reader is registered.
   */
  public async projectLiveness(
    projectId: number,
  ): Promise<ProjectLiveness | undefined> {
    return await this.reader?.projectLiveness(projectId);
  }
}

export type RecordedQuestCommitSource = (
  projectId: number,
) => Promise<RecordedQuestCommits[]>;

export interface RecordedQuestCommits {
  /**
   * The quest's per-project number, `#Q<number>`.
   */
  number: number;
  /**
   * The shas recorded on it, 7 to 40 hex characters each.
   */
  shas: string[];
  completed: boolean;
}

export interface LiveQuestReader {
  whereLive(projectId: number, number: number): Promise<LiveQuestInstance[]>;
  projectLiveness(projectId: number): Promise<ProjectLiveness>;
}

/**
 * One copy running a quest's commits.
 */
export interface LiveQuestInstance {
  instanceId: string;
  app: string;
  env: string;
  /**
   * The working tree the build was pushed from had tracked changes: the
   * commit is in it, but so is something no commit names ("unverified").
   */
  dirty: boolean;
  /**
   * The finish time of the oldest deployment in the newest unbroken run of
   * succeeded deployments carrying the quest. Absent when no run says.
   */
  since?: string;
}

export interface ProjectLiveness {
  /**
   * Quest number to the copies running it. A quest absent here is not live
   * on any copy whose set is known.
   */
  live: Map<number, LiveQuestInstance[]>;
  /**
   * True only when every copy of the project that has deployed has a known,
   * complete set. "Not live anywhere" is claimed from nothing less.
   */
  settled: boolean;
}
