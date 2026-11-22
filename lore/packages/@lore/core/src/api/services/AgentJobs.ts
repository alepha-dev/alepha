import { AlephaError } from "alepha";

import type { HostJobSummary } from "./HostJobs.ts";

/**
 * What a feature module asks of an agent job (#Q3988, #Q3989): Build owns the
 * kind (its profiles, its repositories, its result reader) and registers the
 * launcher here, so Plan starts one without importing Build.
 */
export interface AgentJobRequest {
  projectId: number;
  profile: "read" | "push";
  prompt: string;
  /** Lore's MCP tools the job's key reaches, by their MCP names. */
  tools: string[];
  repository?: string;
  ref?: string;
  questNumber?: number;
  feedbackNumber?: number;
  /** The global triage's items (#Q4183), instead of `feedbackNumber`. */
  feedbackNumbers?: number[];
  /**
   * More turns and time than the profile's, for a job that works through
   * many items (#Q4183). Set by Lore code, never from a prompt; clamped to
   * the profile's own values below and to a ceiling above.
   */
  budget?: { maxTurns: number; timeoutSeconds: number };
  startedBy?: string;
  startedByJobId?: string;
  subjectType: string;
  subjectId: string;
  untrusted?: boolean;
}

export type AgentJobLauncher = (
  request: AgentJobRequest,
) => Promise<HostJobSummary>;

/**
 * The port an agent job starts through. With Build absent, starting one
 * throws: there is no repository to clone.
 */
export class AgentJobs {
  protected launcher?: AgentJobLauncher;

  public register(launcher: AgentJobLauncher): void {
    if (this.launcher) {
      throw new AlephaError("An agent job launcher is already registered");
    }
    this.launcher = launcher;
  }

  public get available(): boolean {
    return this.launcher !== undefined;
  }

  public async start(request: AgentJobRequest): Promise<HostJobSummary> {
    if (!this.launcher) {
      throw new AlephaError("No agent job launcher: Build runs agent jobs");
    }
    return this.launcher(request);
  }
}
