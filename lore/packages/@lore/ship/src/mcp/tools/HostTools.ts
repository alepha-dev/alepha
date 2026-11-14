import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { HostController } from "../../api/controllers/HostController.ts";
import {
  hostStatsParamsSchema,
  hostStatsResultSchema,
} from "../schemas/hostSchemas.ts";

/**
 * A host's CPU and memory over time, for agents (#Q3047), the twin of
 * `lore host stats`.
 *
 * ⚠️ Read-only. It names a host, which the deploy tools never do, because
 * nothing here can act on one: it goes through `getHostStats`, gated on
 * `host:read` in the host's home project, so it reads nothing of an
 * host whose project the caller is not in.
 */
export class HostTools {
  protected readonly hosts = $inject(HostController);
  protected readonly projects = $inject(ProjectTools);

  host_stats = $tool({
    title: "Read a host's stats",
    description:
      "A host's CPU and memory: the current reading, then one mean per day over a window (30 days by default). Readable by the members of its home project whose rank grants host:read; with a project, the slug resolves among that project's own hosts and the ones it borrows, and `home` picks between two of one slug. The daily series is recorded only while somebody switched it on; `collecting` says which.",
    annotations: { readOnlyHint: true },
    schema: {
      params: hostStatsParamsSchema,
      result: hostStatsResultSchema,
    },
    handler: async ({ params }) => {
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
      const host = candidates[0]!;
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
}
