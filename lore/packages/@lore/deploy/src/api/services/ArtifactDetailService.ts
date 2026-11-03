import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";
import { estates } from "../entities/estates.ts";
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
  protected readonly estates = $repository(estates);
  protected readonly builds = $inject(DeployedBuildService);

  public async surroundings(
    projectId: number,
    app: string,
    tag: string,
  ): Promise<Pick<ArtifactDetail, "copies" | "deployments">> {
    const instances = await this.instances.findMany({
      where: { projectId: { eq: projectId }, app: { eq: app } },
    });

    const estateIds = [
      ...new Set(instances.flatMap((it) => (it.estateId ? [it.estateId] : []))),
    ];
    const [estateRows, builds, runs] = await Promise.all([
      estateIds.length
        ? this.estates.findMany({ where: { id: { inArray: estateIds } } })
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
        ],
        where: {
          projectId: { eq: projectId },
          app: { eq: app },
          tag: { eq: tag },
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: ArtifactDetailService.MAX_RUNS,
      }),
    ]);

    const byEstate = new Map(estateRows.map((row) => [row.id, row]));
    const envs = new Map(instances.map((row) => [row.id, row.env]));

    return {
      copies: instances
        .map((instance) => {
          const estate = instance.estateId
            ? byEstate.get(instance.estateId)
            : undefined;
          const build = builds.get(instance.id);
          return {
            id: instance.id,
            env: instance.env,
            ...(estate
              ? {
                  estate: {
                    slug: estate.slug,
                    type: estate.type,
                    label: estate.label,
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
      deployments: runs.map((run) => ({
        ...run,
        env: envs.get(run.instanceId),
      })),
    };
  }
}
