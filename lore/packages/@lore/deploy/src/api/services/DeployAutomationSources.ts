import { AutomationSourceRepository } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments, type Deployment } from "../entities/deployments.ts";

/**
 * Terminal event data contains only a fixed safe projection. Arbitrary adapter
 * errors stay on the deployment record because they can include credentials.
 */
export class DeployAutomationSources {
  protected readonly rows = $inject(AutomationSourceRepository.of(deployments));
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
    const reason =
      status === "failed"
        ? values.error?.startsWith("This deploy never started:")
          ? "Deployment did not start before its timeout."
          : values.error?.startsWith("This deploy stopped reporting after")
            ? "Deployment stopped reporting and was abandoned."
            : "Deployment failed. Inspect its deployment record for details."
        : undefined;
    await this.rows.sourceUpdate(
      { id, status: { inArray: ["queued", "running"] } },
      values as never,
      {
        projectId: row.projectId,
        identity: `deployment:${id}:terminal`,
        resourceId: id,
        name: `deploy.${status}`,
        fields: {
          project: project.title,
          title: `${row.app}: deployment ${status}`,
          deployment_id: id,
          app: row.app,
          env: instance.env,
          tag: row.tag,
          digest: row.sha256,
          ...(reason ? { reason } : {}),
          url: `/${project.slug || `project-${project.id}`}/apps/${encodeURIComponent(row.app)}/${encodeURIComponent(instance.env)}/deploy`,
        },
      },
    );
    return true;
  }
}
