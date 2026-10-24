import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { DeployController } from "../../api/controllers/DeployController.ts";
import { StackController } from "../../api/controllers/StackController.ts";
import { StackDeployController } from "../../api/controllers/StackDeployController.ts";
import type { StackModel } from "../../api/schemas/stackModelSchema.ts";
import type { StackResource } from "../../api/schemas/stackResourceSchema.ts";
import {
  stackDeployParamsSchema,
  stackDeployResultSchema,
  stackGetParamsSchema,
  stackGetResultSchema,
  stackListParamsSchema,
  stackListResultSchema,
  stackLogsParamsSchema,
  stackLogsResultSchema,
  stackRollbackParamsSchema,
} from "../schemas/stackSchemas.ts";

/**
 * Stacks for agents (#Q2697): read them, deploy a revision or one app
 * service, roll back, read a service's logs.
 *
 * Every tool goes through the HTTP actions, so the gates are the same ones
 * (`app:read` to read, `deploy:manage` behind `apps.deploy` to deploy or read
 * logs). ⚠️ No tool returns a variable or a registry credential: there is no
 * value anywhere in these results, by construction, and no estate argument.
 */
export class StackTools {
  protected readonly stacks = $inject(StackController);
  protected readonly deploys = $inject(StackDeployController);
  protected readonly appDeploys = $inject(DeployController);
  protected readonly projects = $inject(ProjectTools);

  stack_list = $tool({
    title: "List stacks",
    description:
      "Every stack of a project (apps and services deployed together from one compose.yml) with its environments, their routes, the revision each runs and their member apps. Readable by any project member.",
    annotations: { readOnlyHint: true },
    schema: { params: stackListParamsSchema, result: stackListResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const { items } = await this.stacks.listStacks({ params: { projectId } });
      return {
        stacks: items.map((stack) => ({
          name: stack.name,
          estateId: stack.estateId,
          latestRevision: stack.latestRevision,
          environments: stack.environments.map((e) => this.environment(e)),
        })),
      };
    },
  });

  stack_get = $tool({
    title: "Read a stack",
    description:
      "One stack: each environment with its routes, members, the services of the revision it runs, and its newest deploys. Readable by any project member. Never a variable value.",
    annotations: { readOnlyHint: true },
    schema: { params: stackGetParamsSchema, result: stackGetResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const stack = await this.stackNamed(projectId, params.stack);
      const revisions = (
        await this.stacks.listStackRevisions({
          params: { projectId, stackId: stack.id },
        })
      ).items;
      const environments = stack.environments.filter(
        (e) => !params.env || e.env === params.env,
      );
      if (params.env && environments.length === 0) {
        throw new NotFoundError(
          `Stack ${stack.name} has no environment ${params.env}`,
        );
      }
      return {
        name: stack.name,
        latestRevision: stack.latestRevision,
        environments: await Promise.all(
          environments.map(async (e) => {
            const applied = revisions.find((r) => r.number === e.revision);
            const model = applied
              ? (JSON.parse(applied.model) as StackModel)
              : undefined;
            const deploys = (
              await this.deploys.listStackDeployments({
                params: { projectId, stackId: stack.id, environmentId: e.id },
              })
            ).items.slice(0, 10);
            return {
              ...this.environment(e),
              services: (model?.services ?? []).map((s) => ({
                name: s.name,
                kind: s.kind,
                app: s.app,
                image: s.image,
              })),
              deploys: deploys.map((d) => ({
                id: d.id,
                revision: d.revision,
                status: d.status,
                error: d.error,
                createdAt: d.createdAt,
              })),
            };
          }),
        ),
      };
    },
  });

  stack_deploy = $tool({
    title: "Deploy a stack",
    description:
      "Apply a revision to a stack environment through its estate (the newest when none is named), or, with `app`, deploy one app service of it alone, blue/green, from a stored build. Refused before anything reaches the machine when the estate does not accept deploys, the revision cannot run there, or a variable it needs is unset. There is no estate argument: where an environment deploys is a property of the environment. Needs deploy rights.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: stackDeployParamsSchema,
      result: stackDeployResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const stack = await this.stackNamed(projectId, params.stack);
      const environment = this.environmentNamed(stack, params.env);
      if (params.app) {
        const member = environment.members.find((m) => m.app === params.app);
        if (!member) {
          throw new BadRequestError(
            `${params.app} is not a member app of ${stack.name}/${environment.env}`,
          );
        }
        const started = await this.appDeploys.startDeploy({
          params: { projectId, instanceId: member.id },
          body: { tag: params.tag ?? "latest" },
        });
        return { id: started.id, status: started.status, kind: "app" as const };
      }
      const row = await this.deploys.deployStackEnvironment({
        params: { projectId, stackId: stack.id, environmentId: environment.id },
        body: { revision: params.revision },
      });
      return { id: row.id, status: row.status, kind: "stack" as const };
    },
  });

  stack_rollback = $tool({
    title: "Roll a stack back",
    description:
      "Deploy an earlier revision of a stack to one environment again. The compose file goes back; volumes and their data do not. Needs deploy rights.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: stackRollbackParamsSchema,
      result: stackDeployResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const stack = await this.stackNamed(projectId, params.stack);
      const environment = this.environmentNamed(stack, params.env);
      const row = await this.deploys.rollbackStackEnvironment({
        params: { projectId, stackId: stack.id, environmentId: environment.id },
        body: { revision: params.revision },
      });
      return { id: row.id, status: row.status, kind: "stack" as const };
    },
  });

  stack_logs = $tool({
    title: "Read a stack service's logs",
    description:
      "Two calls: with `service`, asks the machine for the tail of that service's logs and answers a `request`; with that `request`, answers the lines once the machine has uploaded them (`status` says whether it has). Needs deploy rights: logs can hold what an app printed.",
    annotations: { readOnlyHint: true },
    schema: { params: stackLogsParamsSchema, result: stackLogsResultSchema },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const stack = await this.stackNamed(projectId, params.stack);
      const environment = this.environmentNamed(stack, params.env);
      const where = {
        projectId,
        stackId: stack.id,
        environmentId: environment.id,
      };
      if (params.request) {
        const answer = await this.deploys.readStackLogs({
          params: { ...where, request: params.request },
        });
        return {
          request: params.request,
          status: answer.status,
          reason: answer.reason,
          lines: answer.lines?.map((line) => line.raw),
        };
      }
      if (!params.service) {
        throw new BadRequestError(
          "Name a `service` to read, or pass the `request` an earlier call answered",
        );
      }
      const { request } = await this.deploys.requestStackLogs({
        params: where,
        body: { service: params.service, lines: params.lines ?? 200 },
      });
      return { request, status: "pending" };
    },
  });

  protected environment(e: StackResource["environments"][number]) {
    return {
      env: e.env,
      estateId: e.estateId,
      baseDomain: e.baseDomain,
      revision: e.revision,
      routes: e.routes,
      members: e.members.map((m) => ({ app: m.app, env: m.env })),
    };
  }

  protected async stackNamed(
    projectId: number,
    name: string,
  ): Promise<StackResource> {
    const { items } = await this.stacks.listStacks({ params: { projectId } });
    const stack = items.find((s) => s.name === name.trim().toLowerCase());
    if (!stack) {
      throw new NotFoundError(
        `This project has no stack named ${name}. \`stack_list\` names the ones it has.`,
      );
    }
    return stack;
  }

  protected environmentNamed(stack: StackResource, env: string) {
    const environment = stack.environments.find(
      (e) => e.env === env.trim().toLowerCase(),
    );
    if (!environment) {
      throw new NotFoundError(`Stack ${stack.name} has no environment ${env}`);
    }
    return environment;
  }
}
