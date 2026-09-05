import { $inject, z } from "alepha";
import {
  createParameterVersionBodySchema,
  parameterCurrentResponseSchema,
  parameterHistoryResponseSchema,
  parameterNameParamSchema,
  parameterResponseSchema,
  parameterTreeNodeSchema,
  rollbackParameterBodySchema,
} from "alepha/api/parameters";
import { $action } from "alepha/server";

import { ShowcaseParameters } from "./ShowcaseParameters.ts";

/**
 * Stands in for `AdminParameterController`.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * `createVersion` and `rollback` answer with a plausible version row and store
 * nothing. They have to answer rather than refuse: the component awaits the
 * response before closing its dialog and refetching, so a rejection would
 * leave the save dialog stuck open.
 */
export class ShowcaseParametersController {
  protected readonly parameters = $inject(ShowcaseParameters);

  public readonly getParameterTree = $action({
    path: "/admin/parameters/tree",
    schema: {
      response: z.array(parameterTreeNodeSchema),
    },
    handler: () => this.parameters.tree() as any,
  });

  public readonly getCurrent = $action({
    path: "/admin/parameters/:name",
    schema: {
      params: parameterNameParamSchema,
      response: parameterCurrentResponseSchema,
    },
    handler: ({ params }) => this.parameters.current(params.name) as any,
  });

  public readonly getHistory = $action({
    path: "/admin/parameters/:name/history",
    schema: {
      params: parameterNameParamSchema,
      query: z.object({
        limit: z.integer().optional(),
        offset: z.integer().optional(),
      }),
      response: parameterHistoryResponseSchema,
    },
    handler: ({ params }) =>
      ({
        versions: this.parameters.history(params.name),
      }) as any,
  });

  public readonly createVersion = $action({
    method: "POST",
    path: "/admin/parameters/:name",
    schema: {
      params: parameterNameParamSchema,
      body: createParameterVersionBodySchema,
      response: parameterResponseSchema,
    },
    handler: ({ params }) => this.parameters.history(params.name)[0] as any,
  });

  public readonly rollback = $action({
    method: "POST",
    path: "/admin/parameters/:name/rollback",
    schema: {
      params: parameterNameParamSchema,
      body: rollbackParameterBodySchema,
      response: parameterResponseSchema,
    },
    handler: ({ params }) => this.parameters.history(params.name)[1] as any,
  });

  public readonly deleteParameter = $action({
    method: "DELETE",
    path: "/admin/parameters/:name",
    schema: {
      params: parameterNameParamSchema,
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });
}
