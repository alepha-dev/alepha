import { AutomationEventSubjects } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";

export class DeployAutomationEventSubjects {
  protected readonly registry = $inject(AutomationEventSubjects);
  protected readonly projects = $repository(projects);
  protected readonly instances = $repository(appInstances);
  protected readonly deployments = $repository(deployments);
  constructor() {
    for (const status of ["failed", "succeeded"] as const)
      this.registry.register(`deploy.${status}`, (projectId, id) =>
        this.subject(projectId, id, status),
      );
  }
  protected async subject(
    projectId: number,
    id: string | number,
    status: "failed" | "succeeded",
  ) {
    if (typeof id !== "string")
      throw new BadRequestError(
        "Deployment subjects require a deployment UUID",
      );
    const row = await this.deployments.getOne({ where: { projectId, id } });
    const instance = await this.instances.getOne({
      where: { id: row.instanceId, projectId },
    });
    const project = await this.projects.getById(projectId);
    return {
      title: `${row.app}: deployment ${status}`,
      deployment_id: row.id,
      app: row.app,
      env: instance.env,
      tag: row.tag,
      digest: row.sha256,
      ...(status === "failed"
        ? {
            reason:
              "Deployment failed. Inspect its deployment record for details.",
          }
        : {}),
      url: `/${project.slug || `project-${project.id}`}/apps/${encodeURIComponent(row.app)}/${encodeURIComponent(instance.env)}/deploy`,
    };
  }
}
