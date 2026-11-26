import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { HostController } from "../../api/controllers/HostController.ts";
import { HostJobController } from "../../api/controllers/HostJobController.ts";
import {
  hostJobsParamsSchema,
  hostJobsResultSchema,
  hostStatsParamsSchema,
  hostStatsResultSchema,
} from "../schemas/hostSchemas.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * A host's CPU and memory over time (#Q3047) and the jobs that ran on it
 * (#Q4524), for agents: the twins of `lore host stats` and `lore host jobs`.
 *
 * ⚠️ Read-only. They name a host, which the deploy tools never do, because
 * nothing here can act on one: each goes through an action gated on
 * `host:read` in the host's home project, so it reads nothing of a host
 * whose project the caller is not in. Stopping a job of a machine is
 * `lore host jobs --cancel`, with no tool.
 */
export class HostTools {
  protected readonly hosts = $inject(HostController);
  protected readonly jobs = $inject(HostJobController);
  protected readonly projects = $inject(ProjectTools);

  host_stats = $tool({
    title: "Read a host's stats",
    description:
      "A host's CPU and memory: the current reading, then one mean per day of CPU, memory, disk and load over a window (30 days by default). Readable by the members of its home project whose rank grants host:read; with a project, the slug resolves among that project's own hosts and the ones it borrows, and `home` picks between two of one slug. The daily series is recorded only while somebody switched it on; `collecting` says which.",
    annotations: { readOnlyHint: true },
    schema: {
      params: hostStatsParamsSchema,
      result: hostStatsResultSchema,
    },
    handler: async ({ params }) => {
      const host = await this.named(params);
      const stats = await this.hosts.getHostStats({
        params: { hostId: host.id },
        query: params.since ? { since: params.since } : {},
      });
      return {
        host: host.slug,
        current: {
          cpuPercent: host.cpuPercent,
          memoryPercent: host.memoryPercent,
          statsAt: host.statsAt,
        },
        ...stats,
      };
    },
  });

  host_jobs = $tool({
    title: "List a host's jobs",
    description:
      "Every job that ran on a host, newest first, whatever its project: agent jobs and capability checks, each with its status (queued, running, succeeded, failed, cancelled, timed_out), its times, its tokens and its project. Readable by the members of the host's home project whose rank grants host:read. A job of a project you hold no host:read in comes with `readable: false` and without its prompt, args, subject, starter and reason: those are that project's. Read one readable job whole with job_get.",
    annotations: { readOnlyHint: true },
    schema: { params: hostJobsParamsSchema, result: hostJobsResultSchema },
    handler: async ({ params }) => {
      const host = await this.named(params);
      const { items } = await this.jobs.listHostJobs({
        params: { hostId: host.id },
        query: { limit: params.status ? 500 : (params.limit ?? 50) },
      });
      const kept = params.status
        ? items.filter((item) => item.status === params.status)
        : items;
      return { host: host.slug, jobs: kept.slice(0, params.limit ?? 50) };
    },
  });

  /**
   * The one host a tool names: its slug among the hosts the caller can
   * read, narrowed by the project when one is given, and by `home`.
   */
  protected async named(params: {
    host: string;
    home?: string;
    project?: number;
    project_name?: string;
  }) {
    const projectId =
      params.project !== undefined || params.project_name !== undefined
        ? await this.projects.resolveProjectId(
            params.project,
            params.project_name,
          )
        : undefined;
    const { items } = await this.hosts.listMyHosts({});
    const named = items.filter((item) => item.slug === params.host);
    const inProject =
      projectId === undefined
        ? named
        : named.filter(
            (item) =>
              item.project?.id === projectId ||
              item.projects.some((loan) => loan.id === projectId),
          );
    const home = params.home?.toLowerCase();
    const candidates = (inProject.length ? inProject : named).filter(
      (item) =>
        !home ||
        item.project?.slug?.toLowerCase() === home ||
        item.project?.title.toLowerCase() === home,
    );
    if (candidates.length === 0) {
      throw new NotFoundError(
        `No host named ${params.host} that you can read${params.home ? ` in ${params.home}` : ""}`,
      );
    }
    if (candidates.length > 1) {
      throw new BadRequestError(
        `Several hosts are named ${params.host}: ${candidates
          .map(
            (item) =>
              `${params.host} of ${item.project?.slug ?? item.project?.title ?? "no project"}`,
          )
          .join(", ")}. Pass home.`,
      );
    }
    return candidates[0]!;
  }
}
