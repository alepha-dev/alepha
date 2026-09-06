import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { AppController } from "../../api/controllers/AppController.ts";
import {
  appInstanceCreateParamsSchema,
  appInstanceCreateResultSchema,
  appInstanceDeleteParamsSchema,
  appInstanceDeleteResultSchema,
  appInstanceGetParamsSchema,
  appInstanceGetResultSchema,
  appInstanceListParamsSchema,
  appInstanceListResultSchema,
  appInstanceUpdateParamsSchema,
  appInstanceUpdateResultSchema,
} from "../schemas/index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for app instances — the deployed copies a project tracks.
 *
 * An **instance is `(app, env)`**, both required, both free opaque slugs that
 * nothing parses. `club` in `production` and `club` in `b14-production` are two
 * instances of one app.
 *
 * ⚠️ **There is no `app_create`, and that absence is the model.** There is no
 * app entity: an app exists because an instance names it and stops existing
 * when the last one goes. A tool that created an app would have to create an
 * instance to do it, which is the same reason the table was never built.
 *
 * Two optional unlocks hang off an instance:
 *
 * - a **sigil** (`sigil_create`) is the key it reports with, and unlocks
 *   Analytics, Vitals, Errors and Explore. Removing one destroys that
 *   instance's analytics history.
 * - an **estate** (`app_instance_update`) is where it deploys to, and must be
 *   one lent to this project.
 *
 * Reads are open to any project member; creating, updating and deleting are
 * owner-only, enforced in `AppController` rather than restated here.
 */
export class AppInstanceTools {
  protected readonly apps = $inject(AppController);
  protected readonly projects = $inject(ProjectTools);

  app_instance_list = $tool({
    title: "List app instances",
    description:
      "Every deployed copy this project tracks, one row per `(app, env)` pair, with what each has unlocked: a `sigil` (the key it reports with) and an `estate` (where it deploys to), each absent when it has none. Also returns `apps`, the distinct app names — offer one of those before inventing a new name, because there is no app entity and `clbu` beside `club` is silently a second app.",
    annotations: { readOnlyHint: true },
    schema: {
      params: appInstanceListParamsSchema,
      result: appInstanceListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      const res = await this.apps.listApps({ params: { projectId } });
      return { instances: res.items, apps: res.apps };
    },
  });

  app_instance_get = $tool({
    title: "Read one app instance",
    description:
      "One deployed copy by its pair, with its unlocks. Answers 404 for a pair this project does not have, which is also the answer for a pair another project has: an instance is only ever reachable from the project that owns it.",
    annotations: { readOnlyHint: true },
    schema: {
      params: appInstanceGetParamsSchema,
      result: appInstanceGetResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.apps.getApp({
        params: { projectId, app: params.app, env: params.env },
      });
    },
  });

  app_instance_create = $tool({
    title: "Create an app instance",
    description:
      "Track a deployed copy: you name the app and which copy it is, and nothing is minted. ⚠️ Both are required and neither defaults — omitting the environment on an app that already has a `production` would either collide or silently make a second copy. The key it reports with is `sigil_create`, added afterwards and optional: an instance without one is not broken, it is a copy nobody wired telemetry into. Project owner only. There is deliberately no `app_create`: an app exists because an instance names it.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: appInstanceCreateParamsSchema,
      result: appInstanceCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.apps.createApp({
        params: { projectId },
        body: {
          app: params.app,
          env: params.env,
          ...(params.url === undefined ? {} : { url: params.url }),
        },
      });
    },
  });

  app_instance_update = $tool({
    title: "Update an app instance",
    description:
      'Rename either half, pin the address, or point the copy at an estate. Every field is optional and an omitted one is left alone; `url: ""` clears the pinned address and `estateId: null` clears the deploy target. ⚠️ Both names are the URL, so renaming either MOVES the page — but not the deployed key, which carries the project slug and not these names, so nothing has to be redeployed or rotated. The estate must be one lent to this project. Project owner only.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: appInstanceUpdateParamsSchema,
      result: appInstanceUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.apps.updateApp({
        params: { projectId, app: params.app, env: params.env },
        body: {
          ...(params.newApp === undefined ? {} : { app: params.newApp }),
          ...(params.newEnv === undefined ? {} : { env: params.newEnv }),
          ...(params.url === undefined ? {} : { url: params.url }),
          ...(params.estateId === undefined
            ? {}
            : { estateId: params.estateId }),
        },
      });
    },
  });

  app_instance_delete = $tool({
    title: "Delete an app instance",
    description:
      "⚠️ Removes the deployed copy AND its sigil, and with that sigil everything it ever reported: page views, web vitals, unique visitors and its error budget. Blights already filed are kept. ⚠️ It undeploys nothing — the copy keeps running wherever it runs; what goes is Lore's record of it. To revoke a leaked token without losing the history, use `sigil_rotate`; to remove the credential and keep the copy, use `sigil_delete`. Project owner only.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: appInstanceDeleteParamsSchema,
      result: appInstanceDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.projects.resolveProjectId(
        params.project,
        params.project_name,
      );
      return await this.apps.deleteApp({
        params: { projectId, app: params.app, env: params.env },
      });
    },
  });
}
