import { $inject } from "alepha";
import { $logger } from "alepha/logger";

import type { HostJob } from "../entities/hostJobs.ts";
import {
  GitHubTokenService,
  type GitHubPermissions,
} from "./GitHubTokenService.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";

/**
 * What a job's spec carries for GitHub (#Q4361's wire).
 */
export interface AgentJobGitHubCredential {
  token: string;
  expiresAt: string;
  botName: string;
  botEmail: string;
}

/**
 * An agent job's GitHub token (#Q4365, epic #E177): the Lore half of "no gh
 * sign-in on an Agent host".
 *
 * Minted when the host pulls the job's spec, like the job key, for the
 * project's connected repository and nothing else, and never written to the
 * `host_jobs` row or its input: a queued job holds nothing that could
 * expire or leak. Sent only to a host whose Bay says it runs job tokens
 * (`jobsGitHubTokens`), since an older Bay refuses a spec with a field it
 * does not know.
 *
 * ## The two permission sets
 *
 * The epic review's answer to item 1: `contents` follows the job's source,
 * `read` for a read job and `write` for a write job; every read and write
 * job also gets `pull_requests: write` (review-pr posts its review) and
 * `checks`, `actions`, `statuses`, `metadata` read. A `none` job gets no
 * token. These two are the only sets a job can carry.
 */
export class AgentJobGitHub {
  public static readonly JOB_READ: GitHubPermissions = {
    contents: "read",
    pull_requests: "write",
    checks: "read",
    actions: "read",
    statuses: "read",
    metadata: "read",
  };

  public static readonly JOB_WRITE: GitHubPermissions = {
    ...AgentJobGitHub.JOB_READ,
    contents: "write",
  };

  /**
   * The least a job's token has left when it is handed out: Bay renews at
   * ten minutes left, so a renewal always gets a token that outlives it.
   */
  public static readonly MIN_LIFETIME_MS = 30 * 60_000;

  protected readonly log = $logger();
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly tokens = $inject(GitHubTokenService);

  /**
   * The job's permission set, or none for a job with no code.
   */
  permissionsOf(job: Pick<HostJob, "input">): GitHubPermissions | undefined {
    const mode = job.input.source?.mode;
    if (mode === "read") return AgentJobGitHub.JOB_READ;
    if (mode === "write") return AgentJobGitHub.JOB_WRITE;
    return undefined;
  }

  /**
   * Whether a job of this project would carry a token on a host that runs
   * them: the project is connected to GitHub.
   */
  async covers(projectId: number): Promise<boolean> {
    return (await this.repositories.connectionOf(projectId)) !== undefined;
  }

  /**
   * The credential for a job's spec, or undefined: no code, no connection,
   * or GitHub refused (a revoked installation), in which case the job falls
   * back to the host's own login and says so on its page.
   */
  async credentialFor(
    job: Pick<HostJob, "id" | "projectId" | "input">,
  ): Promise<AgentJobGitHubCredential | undefined> {
    const permissions = this.permissionsOf(job);
    if (!permissions) return undefined;
    const connection = await this.repositories.connectionOf(job.projectId);
    if (!connection) return undefined;
    try {
      const token = await this.tokens.installationToken({
        installationId: connection.installationId,
        repositoryId: connection.repositoryId,
        permissions,
        minLifetimeMs: AgentJobGitHub.MIN_LIFETIME_MS,
      });
      const bot = await this.tokens.botIdentity();
      return {
        token: token.token,
        expiresAt: new Date(token.expiresAt)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        botName: bot.name,
        botEmail: bot.email,
      };
    } catch (error) {
      this.log.warn(
        "No GitHub token for the job: it runs on the host's login",
        {
          jobId: job.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }
}
