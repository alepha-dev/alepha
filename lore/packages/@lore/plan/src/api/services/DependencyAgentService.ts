import { AgentJobs, AgentRunPreamble } from "@lore/core/api";
import {
  type AgentRunRequest,
  projectPrompts,
  projects,
  renderPromptTemplate,
} from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { dependencyUpdatePromptDefault } from "../../web/app/prompts/dependencyUpdatePrompt.ts";
import { securityCheckPromptDefault } from "../../web/app/prompts/securityCheckPrompt.ts";

/**
 * The project's dependencies, on an Agent host (#Q4252): two prompts with
 * defaults the project edits, like Triage and Build, and no code path of
 * their own beyond the source each needs (#Q4248):
 *
 * - **Security check** (`securityCheck`), a read job: the lockfiles audited,
 *   one quest per real vulnerability, nothing filed when there is nothing;
 * - **Dependency update** (`dependencyUpdate`), a write job on a branch Lore
 *   names: the minor and patch updates, a pull
 *   request only when the checks pass.
 *
 * Run by hand (`lore agent run security-check | dependency-update`,
 * `agent_run`) or by an automation (`security`, `dependencies`).
 */
export class DependencyAgentService {
  public static readonly CHECK_SECONDS = 30 * 60;
  public static readonly UPDATE_SECONDS = 2 * 3600;

  protected readonly alepha = $inject(Alepha);
  protected readonly agents = $inject(AgentJobs);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(projectPrompts);

  public async securityCheck(
    projectId: number,
    startedBy: string,
    run: AgentRunRequest = {},
    origin: { automationId?: string; startedByJobId?: string } = {},
  ): Promise<{ jobId: string }> {
    return this.start(projectId, startedBy, run, origin, {
      kind: "securityCheck",
      defaultSource: "read",
      workspace: "security",
      timeoutSeconds: DependencyAgentService.CHECK_SECONDS,
    });
  }

  public async dependencyUpdate(
    projectId: number,
    startedBy: string,
    run: AgentRunRequest = {},
    origin: { automationId?: string; startedByJobId?: string } = {},
  ): Promise<{ jobId: string }> {
    return this.start(projectId, startedBy, run, origin, {
      kind: "dependencyUpdate",
      defaultSource: "write",
      timeoutSeconds: DependencyAgentService.UPDATE_SECONDS,
    });
  }

  protected async start(
    projectId: number,
    startedBy: string,
    run: AgentRunRequest,
    origin: { automationId?: string; startedByJobId?: string },
    options: {
      kind: "securityCheck" | "dependencyUpdate";
      defaultSource: "read" | "write";
      workspace?: string;
      timeoutSeconds: number;
    },
  ): Promise<{ jobId: string }> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) throw new NotFoundError("No such project");
    const [stored] = await this.prompts.findMany({
      where: { projectId: { eq: projectId }, kind: { eq: options.kind } },
      limit: 1,
    });
    const template =
      stored?.template ??
      (options.kind === "securityCheck"
        ? securityCheckPromptDefault
        : dependencyUpdatePromptDefault);
    const slug = project.slug ?? String(project.id);
    const base = String(this.alepha.env.PUBLIC_URL ?? "");
    const job = await this.agents.start({
      projectId,
      ...run,
      prompt: [
        AgentRunPreamble.MARKER,
        "",
        renderPromptTemplate(template, {
          project: project.title,
          slug,
          url: `${base}/${slug}`,
        }),
      ].join("\n"),
      defaultSource: options.defaultSource,
      ...(options.workspace ? { workspace: options.workspace } : {}),
      timeoutSeconds: options.timeoutSeconds,
      startedBy,
      ...(origin.automationId ? { automationId: origin.automationId } : {}),
      ...(origin.startedByJobId
        ? { startedByJobId: origin.startedByJobId }
        : {}),
      subjectType:
        options.kind === "securityCheck" ? "security" : "dependencies",
      subjectId: slug,
    });
    return { jobId: job.id };
  }
}
