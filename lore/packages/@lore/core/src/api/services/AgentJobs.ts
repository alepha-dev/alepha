import { $inject } from "alepha";

import { AgentJobService } from "./AgentJobService.ts";
import type { HostJobSummary } from "./HostJobs.ts";

/**
 * What a feature module asks of an agent job (#Q3988, #Q3989, light since
 * #Q4222): a prompt, the agent and model to run it with, the workspace it
 * runs in, and what the job is about, which pins its key.
 */
export interface AgentJobRequest {
  projectId: number;
  prompt: string;
  /**
   * The agent CLI, by Bay's adapter name (`claude`, `gemini`), and its
   * model. Absent, the host's only agent and the CLI's own default model.
   */
  agent?: string;
  model?: string;
  /**
   * The workspace the job runs in on the host (#Q4218): `q<n>` for a
   * quest's work, `triage` otherwise, unless the caller names one.
   */
  workspace?: string;
  /** The job's time, clamped by `AgentJobService.timeoutOf`. */
  timeoutSeconds?: number;
  questNumber?: number;
  feedbackNumber?: number;
  /** The global triage's items (#Q4183), instead of `feedbackNumber`. */
  feedbackNumbers?: number[];
  /** An epic review's epic (#Q4214), by number: the key is pinned to it. */
  epicNumber?: number;
  startedBy?: string;
  /**
   * The job whose output started this one. Set on its own when a job key
   * makes the request (#Q4222), so the chain guard holds.
   */
  startedByJobId?: string;
  subjectType: string;
  subjectId: string;
  /** Text from outside the team no member trusted: refused. */
  untrusted?: boolean;
}

/**
 * The port feature modules start an agent job through: core's own
 * {@link AgentJobService} since #Q4222, so Plan needs neither Build nor Ship
 * to ask for one.
 */
export class AgentJobs {
  protected readonly service = $inject(AgentJobService);

  public get available(): boolean {
    return true;
  }

  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    return this.service.start(request);
  }
}
