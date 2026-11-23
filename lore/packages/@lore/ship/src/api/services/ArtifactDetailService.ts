import { ProjectRoster } from "@lore/core/api";
import { hosts } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";
import type { ArtifactDetail } from "../schemas/artifactDetailSchema.ts";
import { DeployedBuildService } from "./DeployedBuildService.ts";

/**
 * What surrounds a tag: the copies of its app and the runs that shipped it.
 *
 * The rows of the tag itself stay `ArtifactService`'s. This reads the deploy
 * side, which that service has no business depending on: it is what a deploy
 * depends on, not the other way round.
 */
export class ArtifactDetailService {
  /**
   * How many runs of one tag the page lists. `latest` is redeployed on every
   * green push of `main`, so a page reading them all grows without bound.
   */
  public static readonly MAX_RUNS = 100;

  protected readonly instances = $repository(appInstances);
  protected readonly deployments = $repository(deployments);
  protected readonly hosts = $repository(hosts);
  protected readonly builds = $inject(DeployedBuildService);
  protected readonly roster = $inject(ProjectRoster);

  public async surroundings(
    projectId: number,
    app: string,
    tag: string,
  ): Promise<Pick<ArtifactDetail, "copies" | "deployments">> {
    const instances = await this.instances.findMany({
      where: { projectId: { eq: projectId }, app: { eq: app } },
    });

    const hostIds = [
      ...new Set(instances.flatMap((it) => (it.hostId ? [it.hostId] : []))),
    ];
    const [hostRows, builds, runs, members] = await Promise.all([
      hostIds.length
        ? this.hosts.findMany({ where: { id: { inArray: hostIds } } })
        : Promise.resolve([]),
      this.builds.latest(instances.map((it) => it.id)),
      this.deployments.findMany({
        // ⚠️ Named columns: `log` is left behind on purpose (#Q2682).
        columns: [
          "id",
          "instanceId",
          "sha256",
          "status",
          "url",
          "error",
          "createdAt",
          "startedAt",
          "finishedAt",
          "createdBy",
        ],
        where: {
          projectId: { eq: projectId },
          app: { eq: app },
          tag: { eq: tag },
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: ArtifactDetailService.MAX_RUNS,
      }),
      // The Deployments tab's Author column (#Q3669): one read of the
      // project's members, rather than a user lookup per run.
      this.roster.of(projectId),
    ]);

    const byHost = new Map(hostRows.map((row) => [row.id, row]));
    const envs = new Map(instances.map((row) => [row.id, row.env]));
    const names = new Map(members.map((it) => [it.userId, it.label]));

    return {
      copies: instances
        .map((instance) => {
          const host = instance.hostId
            ? byHost.get(instance.hostId)
            : undefined;
          const build = builds.get(instance.id);
          return {
            id: instance.id,
            env: instance.env,
            ...(host
              ? {
                  host: {
                    slug: host.slug,
                    type: host.type,
                    label: host.label,
                  },
                }
              : {}),
            ...(build
              ? {
                  deployed: {
                    tag: build.tag,
                    sha256: build.sha256,
                    at: build.at,
                  },
                }
              : {}),
          };
        })
        .sort((a, b) => a.env.localeCompare(b.env)),
      deployments: runs.map(({ createdBy, ...run }) => ({
        ...run,
        env: envs.get(run.instanceId),
        ...(createdBy && names.get(createdBy)
          ? { author: names.get(createdBy) }
          : {}),
      })),
    };
  }
}
