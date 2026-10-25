import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import type { StackDeployment } from "../entities/stackDeployments.ts";
import { stackDeploymentResourceSchema } from "../schemas/stackDeploymentResourceSchema.ts";
import { stackServicesResourceSchema } from "../schemas/stackServicesResourceSchema.ts";
import { StackConsoleService } from "../services/StackConsoleService.ts";
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
  protected readonly console = $inject(StackConsoleService);

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

  requestStackLogs = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/logs",
    description:
      "Ask the estate for the tail of one service's logs. Answers a request id; read the lines with the GET of the same path once the machine has answered.",
    schema: {
      params: this.params,
      body: z.object({
        service: z.string().min(1).max(100),
        lines: z.integer().min(1).max(2000).default(200),
      }),
      response: z.object({ request: z.uuid() }),
    },
    handler: async ({ params, body, user }) => {
      const command = await this.deploys.requestLogs({
        ...params,
        service: body.service,
        lines: body.lines,
        createdBy: user?.id,
      });
      return { request: command.id };
    },
  });

  readStackLogs = $action({
    use: [this.writeGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/logs/:request",
    description:
      "A logs request's status, and its lines once the machine has uploaded them.",
    schema: {
      params: this.params.extend({ request: z.uuid() }),
      response: z.object({
        status: z.string(),
        reason: z.string().optional(),
        lines: z
          .array(
            z.object({
              at: z.string().optional(),
              level: z.string().optional(),
              text: z.string().optional(),
              raw: z.string(),
            }),
          )
          .optional(),
      }),
    },
    handler: async ({ params }) =>
      await this.deploys.readLogs({
        projectId: params.projectId,
        stackId: params.stackId,
        environmentId: params.environmentId,
        commandId: params.request,
      }),
  });

  listStackServices = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/services",
    description:
      "A stack environment's services: what the applied revision declares, joined with what the machine last reported (state, memory, restarts), and its volumes with their backup coverage.",
    schema: { params: this.params, response: stackServicesResourceSchema },
    handler: async ({ params }) =>
      await this.console.servicesOf(
        params.projectId,
        params.stackId,
        params.environmentId,
      ),
  });

  stackServiceAction = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/services/:service/:verb",
    description:
      "Restart, stop or start one service of a stack environment. A stop is durable: the way back is start or a deploy.",
    schema: {
      params: this.params.extend({
        service: z.string().min(1).max(100),
        verb: z.enum(StackConsoleService.SERVICE_VERBS),
      }),
      response: z.object({ command: z.uuid() }),
    },
    handler: async ({ params, user }) => {
      const command = await this.console.serviceAction({
        projectId: params.projectId,
        stackId: params.stackId,
        environmentId: params.environmentId,
        service: params.service,
        verb: params.verb,
        requestedBy: user?.id,
      });
      return { command: command.id };
    },
  });

  protected resource(row: StackDeployment) {
    const { estateId: _estateId, ...rest } = row;
    return rest;
  }
}
