import type { AgentJobStepsValue } from "../schemas/agentJobStepsSchema.ts";
import type { PromptJobArg } from "../schemas/promptJobArgSchema.ts";

/**
 * What a steps reader is told of a job: enough to find its quests and,
 * for a `work-epic` run, its epic, and the window its steps fall in.
 */
export interface AgentJobStepsJob {
  id: string;
  projectId: number;
  prompt?: string;
  args?: PromptJobArg[];
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
}

/**
 * The reader Plan registers: the steps of a list of jobs, read from the
 * quests in a fixed number of queries whatever the list's length. A job
 * that accepted no quest, and has no pending one, is absent from the map.
 */
export interface AgentJobStepsReader {
  read(jobs: AgentJobStepsJob[]): Promise<Map<string, AgentJobStepsValue>>;
}

/**
 * The port a job's steps are read through (#Q4433, epic #E181). The job
 * pages live in `@lore/prompts` and core, the quests in `@lore/plan`, and a
 * feature package never imports another, so core declares the port and
 * Plan fills it at start, as `@lore/prompts` fills `AgentJobs`. Unfilled,
 * it answers nothing: every job reads as one with no steps.
 */
export class AgentJobSteps {
  protected reader?: AgentJobStepsReader;

  public register(reader: AgentJobStepsReader): void {
    this.reader = reader;
  }

  public get available(): boolean {
    return this.reader !== undefined;
  }

  /**
   * The steps of these jobs, by job id.
   */
  public async read(
    jobs: AgentJobStepsJob[],
  ): Promise<Map<string, AgentJobStepsValue>> {
    if (!this.reader || jobs.length === 0) return new Map();
    return this.reader.read(jobs);
  }
}
