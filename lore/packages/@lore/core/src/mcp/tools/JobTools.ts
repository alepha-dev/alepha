import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { AgentHostController } from "../../api/controllers/AgentHostController.ts";
import { HostJobController } from "../../api/controllers/HostJobController.ts";
import {
  agentHostsParamsSchema,
  agentHostsResultSchema,
  jobGetParamsSchema,
  jobGetResultSchema,
  jobIdParamsSchema,
  jobListParamsSchema,
  jobListResultSchema,
} from "../schemas/jobSchemas.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * A project's host jobs, for agents (#Q3984): the twins of `lore job list`,
 * `lore job get` and `lore job cancel`. Each goes through the job page's own
 * action, gated on `host:read` in the job's project.
 */
export class JobTools {
  protected readonly jobs = $inject(HostJobController);
  protected readonly projects = $inject(ProjectTools);
  protected readonly agentHosts = $inject(AgentHostController);

  agent_hosts = $tool({
    title: "List Agent hosts",
    description:
      "The project's Agent hosts, its own and those lent to it: each one's last check (available or not, and why), the agent CLIs it reports (what agent_run's `agent` names), and every tool its jobs user has (agent CLIs, git, gh, lore) with a version or the error of its version command. Whether a tool is signed in is not checked. Readable by members whose rank grants host:read.",
    annotations: { readOnlyHint: true },
    schema: { params: agentHostsParamsSchema, result: agentHostsResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const { items } = await this.agentHosts.listProjectAgentHosts({
        params: { projectId },
      });
      return { hosts: items };
    },
  });

  job_list = $tool({
    title: "List host jobs",
    description:
      "The project's host jobs, newest first: agent jobs (an agent CLI on an Agent host) and capability checks, each with its status (queued, running, succeeded, failed, cancelled, timed_out), its host, who started it and what it is about. Readable by members whose rank grants host:read.",
    annotations: { readOnlyHint: true },
    schema: { params: jobListParamsSchema, result: jobListResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const { items } = await this.jobs.listProjectJobs({
        params: { projectId },
        query: { limit: params.status ? 500 : (params.limit ?? 50) },
      });
      const kept = params.status
        ? items.filter((item) => item.status === params.status)
        : items;
      return {
        jobs: kept
          .slice(0, params.limit ?? 50)
          .map(({ input: _input, ...rest }) => rest),
      };
    },
  });

  job_get = $tool({
    title: "Read a host job",
    description:
      "One host job: what it ran (agent, model, workspace, prompt, timeout), its status, exit code and reason, and with `log` its output so far.",
    annotations: { readOnlyHint: true },
    schema: { params: jobGetParamsSchema, result: jobGetResultSchema },
    handler: async ({ params }) => {
      const job = await this.jobs.getJob({ params: { jobId: params.id } });
      if (!params.log) return job;
      const log = await this.jobs.getJobLog({
        params: { jobId: params.id },
        query: {},
      });
      return { ...job, stdout: log.stdout, stderr: log.stderr };
    },
  });

  job_cancel = $tool({
    title: "Cancel a host job",
    description:
      "Stops a host job: a queued one ends at once, a running one is killed on its host and ends cancelled.",
    schema: { params: jobIdParamsSchema, result: jobGetResultSchema },
    handler: async ({ params }) => {
      return this.jobs.cancelJob({ params: { jobId: params.id } });
    },
  });
}
