import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, NotFoundError, okSchema } from "alepha/server";

import type { Stack } from "../entities/stacks.ts";
import { stackEnvironmentResourceSchema } from "../schemas/stackEnvironmentResourceSchema.ts";
import { stackResourceSchema } from "../schemas/stackResourceSchema.ts";
import { stackRevisionResourceSchema } from "../schemas/stackRevisionResourceSchema.ts";
import { StackService } from "../services/StackService.ts";

/**
 * Stacks: apps and services deployed together from one `compose.yml`.
 *
 * They live under the Apps capability with its `deploy` option, like the
 * Deploy and Environment tabs: reads take `app:read` and no capability (a
 * project that turns `deploy` off gets its stacks back untouched when it
 * returns), writes take `deploy:manage` behind `apps.deploy`.
 */
export class StackController {
  protected readonly stacks = $inject(StackService);

  protected writeGate = () =>
    $ownsProject({
      param: "projectId",
      requires: "deploy:manage",
      capability: { key: "apps", option: "deploy" },
    });

  protected readGate = () =>
    $ownsProject({ param: "projectId", requires: "app:read" });

  listStacks = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks",
    description:
      "Every stack of the project, with its environments, routes and member apps.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(stackResourceSchema) }),
    },
    handler: async ({ params }) => {
      const rows = await this.stacks.list(params.projectId);
      return { items: await this.resources(rows) };
    },
  });

  getStack = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId",
    description: "One stack, with its environments, routes and member apps.",
    schema: {
      params: z.object({ projectId: z.integer(), stackId: z.uuid() }),
      response: stackResourceSchema,
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      return (await this.resources([stack]))[0];
    },
  });

  createStack = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks",
    description: "Create a stack. Its name defaults to the project slug.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        name: z.string().min(1).max(64).optional(),
        /**
         * The default estate, which must be lent to this project.
         */
        estateId: z.uuid().optional(),
      }),
      response: stackResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const stack = await this.stacks.create({
        projectId: params.projectId,
        name: body.name,
        estateId: body.estateId,
        createdBy: user?.id,
      });
      return (await this.resources([stack]))[0];
    },
  });

  updateStack = $action({
    use: [this.writeGate()],
    method: "PATCH",
    path: "/projects/:projectId/stacks/:stackId",
    description: "Set or clear the stack's default estate.",
    schema: {
      params: z.object({ projectId: z.integer(), stackId: z.uuid() }),
      body: z.object({ estateId: z.uuid().nullable() }),
      response: stackResourceSchema,
    },
    handler: async ({ params, body }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const updated = await this.stacks.setEstate(stack, body.estateId);
      return (await this.resources([updated]))[0];
    },
  });

  deleteStack = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/stacks/:stackId",
    description:
      "Delete a stack, its environments, routes and revisions. Member apps stay, as ordinary copies. Nothing on an estate is touched.",
    schema: {
      params: z.object({ projectId: z.integer(), stackId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      await this.stacks.delete(stack);
      return { ok: true };
    },
  });

  createStackEnvironment = $action({
    use: [this.writeGate()],
    method: "POST",
    path: "/projects/:projectId/stacks/:stackId/environments",
    description: "Add an environment to a stack, optionally on its own estate.",
    schema: {
      params: z.object({ projectId: z.integer(), stackId: z.uuid() }),
      body: z.object({
        env: z.string().min(1).max(64),
        estateId: z.uuid().optional(),
        baseDomain: z.string().max(253).optional(),
      }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params, body }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.createEnvironment(stack, body);
      return { ...environment, routes: [], members: [] };
    },
  });

  updateStackEnvironment = $action({
    use: [this.writeGate()],
    method: "PATCH",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId",
    description:
      "Set or clear an environment's estate override and base domain. Only the keys sent change.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
      }),
      body: z.object({
        estateId: z.uuid().nullable().optional(),
        baseDomain: z.string().max(253).nullable().optional(),
      }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params, body }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.updateEnvironment(stack, environment, body);
      return await this.environmentResource(stack, params.environmentId);
    },
  });

  deleteStackEnvironment = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId",
    description:
      "Forget a stack environment and its routes. Member apps stay, as ordinary copies. Nothing on an estate is touched.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.deleteEnvironment(environment);
      return { ok: true };
    },
  });

  addStackRoute = $action({
    use: [this.writeGate()],
    method: "PUT",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/routes",
    description: "Serve a full domain from one service of a stack environment.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
      }),
      body: z.object({
        service: z.string().min(1).max(100),
        domain: z.string().min(1).max(253),
      }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params, body }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.addRoute(environment, body);
      return await this.environmentResource(stack, environment.id);
    },
  });

  removeStackRoute = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/routes",
    description: "Stop serving a full domain from a stack environment.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
      }),
      query: z.object({ domain: z.string().min(1).max(253) }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params, query }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.removeRoute(environment, query.domain);
      return await this.environmentResource(stack, environment.id);
    },
  });

  attachStackMember = $action({
    use: [this.writeGate()],
    method: "PUT",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/members",
    description:
      "Make an app instance of this project, with the environment's own env name, a member of the environment.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
      }),
      body: z.object({ instanceId: z.uuid() }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params, body }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.attachInstance(stack, environment, body.instanceId);
      return await this.environmentResource(stack, environment.id);
    },
  });

  detachStackMember = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/members/:instanceId",
    description: "Make a member app an ordinary copy again.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        stackId: z.uuid(),
        environmentId: z.uuid(),
        instanceId: z.uuid(),
      }),
      response: stackEnvironmentResourceSchema,
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const environment = await this.stacks.getEnvironment(
        stack,
        params.environmentId,
      );
      await this.stacks.detachInstance(environment, params.instanceId);
      return await this.environmentResource(stack, environment.id);
    },
  });

  listStackRevisions = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/revisions",
    description:
      "A stack's revisions, newest first, with their compose text and model.",
    schema: {
      params: z.object({ projectId: z.integer(), stackId: z.uuid() }),
      response: z.object({ items: z.array(stackRevisionResourceSchema) }),
    },
    handler: async ({ params }) => {
      const stack = await this.stacks.get(params.projectId, params.stackId);
      const rows = await this.stacks.revisionsOf(stack);
      return { items: rows.map(({ fileId: _fileId, ...rest }) => rest) };
    },
  });

  /**
   * Batched: one read per table for any number of stacks, never one per row.
   */
  protected async resources(rows: Stack[]) {
    const environments = await this.stacks.environmentsOf(
      rows.map((s) => s.id),
    );
    const ids = environments.map((e) => e.id);
    const [routes, members, latest] = await Promise.all([
      this.stacks.routesOf(ids),
      this.stacks.membersOf(ids),
      Promise.all(rows.map((s) => this.stacks.revisionsOf(s))),
    ]);
    return rows.map((stack, i) => {
      const { createdBy: _createdBy, ...row } = stack;
      return {
        ...row,
        latestRevision: latest[i][0]?.number,
        environments: environments
          .filter((e) => e.stackId === stack.id)
          .map((e) => ({
            ...e,
            routes: routes
              .filter((r) => r.environmentId === e.id)
              .map((r) => ({ service: r.service, domain: r.domain })),
            members: members
              .filter((m) => m.stackEnvironmentId === e.id)
              .map((m) => ({ id: m.id, app: m.app, env: m.env })),
          })),
      };
    });
  }

  protected async environmentResource(stack: Stack, environmentId: string) {
    const resource = (await this.resources([stack]))[0];
    const environment = resource.environments.find(
      (e) => e.id === environmentId,
    );
    if (!environment) {
      throw new NotFoundError(`Stack ${stack.name} has no such environment`);
    }
    return environment;
  }
}
