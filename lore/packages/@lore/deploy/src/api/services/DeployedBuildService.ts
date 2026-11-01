import { $repository } from "alepha/orm";

import { deployments } from "../entities/deployments.ts";

/**
 * What one copy last shipped, from the snapshot its newest succeeded run took.
 */
export interface DeployedBuild {
  tag: string;
  sha256: string;
  artifactId?: string;
  at: string;
}

/**
 * Which build each copy is running.
 *
 * Shared by the Apps list, which shows the tag, and the artifact page, which
 * compares the digest. ⚠️ The digest is the only honest comparison: `latest`
 * is replaced in place, so two copies reading `latest` may run different
 * bytes, and a tag alone would call both current.
 */
export class DeployedBuildService {
  protected readonly deployments = $repository(deployments);

  /**
   * Each instance's newest succeeded run.
   *
   * ⚠️ **Two narrow reads, never the whole history** (#Q2682). The first finds
   * each instance's newest succeeded run, the second reads only the snapshot
   * of those runs. A plain `findMany` here loaded every succeeded deployment
   * of every listed instance, `log` included, on each Apps list render, and
   * timed out on D1 once those logs grew.
   */
  public async latest(
    instanceIds: string[],
  ): Promise<Map<string, DeployedBuild>> {
    if (instanceIds.length === 0) {
      return new Map();
    }
    const newest = await this.deployments.aggregate({
      select: { instanceId: true, createdAt: { max: true } },
      where: {
        instanceId: { inArray: instanceIds },
        status: { eq: "succeeded" },
      },
      groupBy: ["instanceId"],
    });
    const latest = new Map<string, string>();
    for (const row of newest) {
      if (row.createdAt.max) {
        latest.set(row.instanceId, row.createdAt.max);
      }
    }
    if (latest.size === 0) {
      return new Map();
    }

    const runs = await this.deployments.findMany({
      columns: ["instanceId", "tag", "sha256", "artifactId", "createdAt"],
      where: {
        instanceId: { inArray: [...latest.keys()] },
        status: { eq: "succeeded" },
        createdAt: { inArray: [...new Set(latest.values())] },
      },
    });
    const builds = new Map<string, DeployedBuild>();
    for (const run of runs) {
      if (latest.get(run.instanceId) === run.createdAt) {
        builds.set(run.instanceId, {
          tag: run.tag,
          sha256: run.sha256,
          artifactId: run.artifactId,
          at: run.createdAt,
        });
      }
    }
    return builds;
  }
}
