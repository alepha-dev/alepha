import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import type { StackDeployment } from "../entities/stackDeployments.ts";
import { hostCommandResourceSchema } from "../schemas/hostCommandResourceSchema.ts";
import { stackDeploymentResourceSchema } from "../schemas/stackDeploymentResourceSchema.ts";
import { stackServicesResourceSchema } from "../schemas/stackServicesResourceSchema.ts";
import { BayRemovalService } from "../services/BayRemovalService.ts";
import { StackConsoleService } from "../services/StackConsoleService.ts";
import { StackDeployService } from "../services/StackDeployService.ts";
import { StackService } from "../services/StackService.ts";

/**
 * Deploying a stack environment, rolling it back, and its deploy log (#Q2694).
 *
 * There is no host argument anywhere, as on an app deploy: the host is a
 * property of the environment (or the stack's default), resolved server-side.
 * Writes take `deploy:manage` behind `apps.stacks`; the log takes `app:read`.
 */
export class StackDeployController {
  protected readonly stacks = $inject(StackService);
  protected readonly deploys = $inject(StackDeployService);
  protected readonly console = $inject(StackConsoleService);
  protected readonly removals = $inject(BayRemovalService);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "stacks" },
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
      "Deploy a revision (the newest when none is named) to a stack environment, through its host.",
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
      "Ask the host for the tail of one service's logs. Answers a request id; read the lines with the GET of the same path once the machine has answered.",
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

  /**
   * Ask the host to take a stack environment down and forget it (#Q3153,
   * folio #F1455): `bay stack destroy` without `--purge`, so its volumes,
   * variables and registry credentials stay on the machine. Lore's own record
   * of the environment is untouched: delete it once the removal is done.
   *
   * Answers no command for an environment that was never deployed, since
   * there is nothing on a machine to remove.
   */
  removeStackEnvironment = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/remove",
    description:
      "Queue the removal of a stack environment from its Bay, its volumes kept. Lore's record stays until it is deleted.",
    schema: {
      params: this.params,
      response: z.object({
        command: hostCommandResourceSchema.optional(),
        host: z.string().optional(),
      }),
    },
    handler: async ({ params, user }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      const queued = await this.removals.removeStackEnvironment(
        stack,
        environment,
        user?.id,
      );
      return queued ? { command: queued.command, host: queued.host.slug } : {};
    },
  });

  getStackRemoval = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/remove/:commandId",
    schema: {
      params: this.params.extend({ commandId: z.uuid() }),
      response: hostCommandResourceSchema,
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      return this.removals.readStackRemoval(
        stack,
        environment,
        params.commandId,
      );
    },
  });

  protected resource(row: StackDeployment) {
    const { hostId: _hostId, ...rest } = row;
    return rest;
  }
}
