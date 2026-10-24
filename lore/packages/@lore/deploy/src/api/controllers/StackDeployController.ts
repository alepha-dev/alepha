import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import type { StackDeployment } from "../entities/stackDeployments.ts";
import { stackDeploymentResourceSchema } from "../schemas/stackDeploymentResourceSchema.ts";
import { StackDeployService } from "../services/StackDeployService.ts";
import { StackService } from "../services/StackService.ts";

/**
 * Deploying a stack environment, rolling it back, and its deploy log (#Q2694).
 *
 * There is no estate argument anywhere, as on an app deploy: the estate is a
 * property of the environment (or the stack's default), resolved server-side.
 * Writes take `deploy:manage` behind `apps.deploy`; the log takes `app:read`.
 */
export class StackDeployController {
  protected readonly stacks = $inject(StackService);
  protected readonly deploys = $inject(StackDeployService);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  protected readonly params = z.object({
    projectId: z.integer(),
    stackId: z.uuid(),
    environmentId: z.uuid(),
  });

  deployStackEnvironment = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/deploy",
    description:
      "Deploy a revision (the newest when none is named) to a stack environment, through its estate.",
    schema: {
      params: this.params,
      body: z.object({ revision: z.integer().min(1).optional() }),
      response: stackDeploymentResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.resource(
        await this.deploys.deploy({
          projectId: params.projectId,
          stackId: params.stackId,
          environmentId: params.environmentId,
          revision: body.revision,
          createdBy: user?.id,
        }),
      ),
  });

  rollbackStackEnvironment = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/rollback",
    description:
      "Deploy an earlier revision again. Volumes and their data are untouched.",
    schema: {
      params: this.params,
      body: z.object({ revision: z.integer().min(1) }),
      response: stackDeploymentResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      this.resource(
        await this.deploys.deploy({
          projectId: params.projectId,
          stackId: params.stackId,
          environmentId: params.environmentId,
          revision: body.revision,
          createdBy: user?.id,
        }),
      ),
  });

  listStackDeployments = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/deployments",
    description:
      "A stack environment's deploys, newest first, with each one's plan and service outcomes.",
    schema: {
      params: this.params,
      response: z.object({ items: z.array(stackDeploymentResourceSchema) }),
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      return {
        items: (await this.deploys.list(environment.id)).map((row) =>
          this.resource(row),
        ),
      };
    },
  });

  protected resource(row: StackDeployment) {
    const { estateId: _estateId, ...rest } = row;
    return rest;
  }
}
