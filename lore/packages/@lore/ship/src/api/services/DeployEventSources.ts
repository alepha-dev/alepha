import { SourceRepository } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments, type Deployment } from "../entities/deployments.ts";
import { ShipProjectEvents } from "./ShipProjectEvents.ts";

/**
 * Terminal event data contains only a fixed safe projection. Arbitrary adapter
 * errors stay on the deployment record because they can include credentials.
 */
export class DeployEventSources {
  /**
   * Injected so the events this class records are in the catalog
   * whatever booted it (#Q3889).
   */
  protected readonly eventDefinitions = $inject(ShipProjectEvents);
  protected readonly rows = $inject(SourceRepository.of(deployments));
  protected readonly instances = $repository(appInstances);
  protected readonly projects = $repository(projects);
  public async terminal(
    id: string,
    values: Partial<Deployment>,
  ): Promise<boolean> {
    const row = await this.rows.getById(id);
    if (!["queued", "running"].includes(row.status))
      return row.status === values.status;
    const instance = await this.instances.getById(row.instanceId);
    const project = await this.projects.getById(row.projectId);
    const status = values.status === "succeeded" ? "succeeded" : "failed";
    // The project event stores data, not sentences (#Q3889): the reason as
    // a code, the title as the app.
    const cause =
      status === "failed"
        ? values.error?.startsWith("This deploy never started:")
          ? "timeout"
          : values.error?.startsWith("This deploy stopped reporting after")
            ? "abandoned"
            : "failed"
        : undefined;
    await this.rows.sourceUpdate(
      { id, status: { inArray: ["queued", "running"] } },
      values,
      {
        projectId: row.projectId,
        resourceId: id,
        name: `deploy.${status}`,
        subjectId: id,
        fields: {
          project: project.title,
          title: row.app,
          deployment_id: id,
          app: row.app,
          env: instance.env,
          tag: row.tag,
          digest: row.sha256,
          reason: cause ?? null,
          url: `/${project.slug || `project-${project.id}`}/apps/${encodeURIComponent(row.app)}/${encodeURIComponent(instance.env)}/deploy`,
        },
      },
    );
    return true;
  }
}
