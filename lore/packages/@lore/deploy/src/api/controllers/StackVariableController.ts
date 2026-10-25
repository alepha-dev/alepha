import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import type { StackVariable } from "../entities/stackVariables.ts";
import { stackVariableResourceSchema } from "../schemas/stackVariableResourceSchema.ts";
import { StackService } from "../services/StackService.ts";
import { StackVariableService } from "../services/StackVariableService.ts";

/**
 * A stack environment's variables (#Q2692), the stack twin of the app
 * Environment tab.
 *
 * ⚠️ No response carries a value, for anybody, on the way in or out: names,
 * a short prefix of the long ones, whether Lore generated it, and who set it
 * last. Reads take `app:read`; writes `deploy:manage` behind `apps.deploy`.
 */
export class StackVariableController {
  protected readonly stacks = $inject(StackService);
  protected readonly variables = $inject(StackVariableService);

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

  listStackVariables = $action({
    use: [this.readGate()],
    method: "GET",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/variables",
    description:
      "A stack environment's variables: names and masks, never a value.",
    schema: {
      params: this.params,
      response: z.object({ items: z.array(stackVariableResourceSchema) }),
    },
    handler: async ({ params }) => {
      const environment = await this.environment(params);
      return {
        items: (await this.variables.list(environment.id)).map((row) =>
          this.resource(row),
        ),
      };
    },
  });

  setStackVariable = $action({
    use: [this.writeGate()],
    method: "PUT",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/variables",
    description:
      "Set one variable, or generate a random hex value server-side with `generate` (its length), so the value never passes through a terminal.",
    schema: {
      params: this.params,
      body: z.object({
        key: z.string().min(1).max(100),
        /**
         * ⚠️ The one place a value is on the wire, one way.
         */
        value: z
          .string()
          .min(1)
          .max(StackVariableService.MAX_VALUE_LENGTH)
          .optional(),
        generate: z
          .integer()
          .min(16)
          .max(StackVariableService.MAX_GENERATED_LENGTH)
          .optional(),
      }),
      response: stackVariableResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const environment = await this.environment(params);
      return this.resource(
        await this.variables.set({
          environment,
          key: body.key,
          value: body.value,
          generate: body.generate,
          updatedBy: user?.id,
        }),
      );
    },
  });

  removeStackVariable = $action({
    use: [this.writeGate()],
    method: "DELETE",
    path: "/projects/:projectId/stacks/:stackId/environments/:environmentId/variables",
    description: "Remove one variable from a stack environment.",
    schema: {
      params: this.params,
      query: z.object({ key: z.string().min(1).max(100) }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.variables.remove(await this.environment(params), query.key);
      return { ok: true };
    },
  });

  protected async environment(params: {
    projectId: number;
    stackId: string;
    environmentId: string;
  }) {
    const stack = await this.stacks.get(params.projectId, params.stackId);
    return await this.stacks.getEnvironment(stack, params.environmentId);
  }

  protected resource(row: StackVariable) {
    return {
      id: row.id,
      key: row.key,
      valuePrefix: row.valuePrefix,
      generated: row.generated,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }
}
