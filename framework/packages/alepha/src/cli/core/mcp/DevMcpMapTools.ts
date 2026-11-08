import { $inject, z } from "alepha";
import type { DevMetadata } from "alepha/inspector";
import { $tool } from "alepha/mcp";

import {
  type AppMapInput,
  type AppMapOrigin,
  AppMapRenderer,
} from "../services/AppMapRenderer.ts";
import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: what the selected app registers, rendered by the same
 * `AppMapRenderer` as `alepha docs --app`, over the live `/metadata`.
 *
 * ⚠️ `/metadata` carries the live environment values, secrets included, and
 * the atoms' values. Neither leaves this server: the renderer prints env
 * names, types and defaults, and atoms by key and type.
 */
export class DevMcpMapTools {
  protected readonly session = $inject(DevMcpSession);
  protected readonly renderer = $inject(AppMapRenderer);

  protected readonly origin: AppMapOrigin = {
    source: "read from the running app by `alepha mcp`",
    detail: "with app_map's `section`, or one item with app_describe",
  };

  public readonly appMap = $tool({
    name: "app_map",
    description:
      "The map of the selected app: its actions, entities, pages, jobs, topics, modules, atoms, realms, roles, permissions and env variables, one line each and no schemas. Pass `section` for one section in full (schemas, columns), and `filter` to keep the items mentioning a word. Read it before calling an action or reading rows. On a large app the overview runs to tens of kilobytes: pass `filter` first.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        section: z
          .enum(
            new AppMapRenderer().sections.filter(
              (section) => section !== "routes",
            ) as [string, ...string[]],
          )
          .describe("One section in full, schemas included")
          .optional(),
        filter: z
          .text()
          .describe("Keep only the items whose text contains this word")
          .optional(),
      }),
    },
    handler: async ({ params }) => {
      const input = await this.input();
      if (typeof input === "string") return input;
      return this.renderer.render(
        input,
        params.section,
        params.filter,
        this.origin,
      );
    },
  });

  public readonly appDescribe = $tool({
    name: "app_describe",
    description:
      "One item of the selected app in full: an action with its method, path, params / query / body / response types, its $secure rule and declared errors; an entity with its columns; a page with its path and params; a job with its schedule. Name an action `group.name` (as app_map prints it), its bare name, or its path.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        kind: z.enum(
          Object.keys(new AppMapRenderer().kinds) as [string, ...string[]],
        ),
        name: z.text({ size: "long" }),
      }),
    },
    handler: async ({ params }) => {
      const input = await this.input();
      if (typeof input === "string") return input;
      const kind = params.kind as keyof AppMapRenderer["kinds"];
      const found = this.renderer.describe(input, kind, params.name);
      if (found) return found;
      const close = this.renderer.candidates(input, kind, params.name);
      return close.length
        ? `No single ${kind} is named "${params.name}". Closest: ${close.join(", ")}.`
        : `No ${kind} is named "${params.name}". app_map lists them.`;
    },
  });

  /**
   * The selected app's metadata as the renderer's input, or the sentence to
   * answer with.
   */
  protected async input(): Promise<AppMapInput | string> {
    const target = await this.session.target();
    if (!target.connection) return target.answer;
    const meta = await target.connection.call("metadata");
    return this.toInput(target.connection.run.name, meta);
  }

  /**
   * Only what the renderer reads; `/metadata` has no route list, so the
   * routes section is left out.
   */
  protected toInput(name: string, meta: DevMetadata): AppMapInput {
    return {
      name,
      actions: meta.actions,
      entities: meta.entities,
      pages: meta.pages,
      jobs: meta.jobs,
      topics: meta.topics,
      modules: meta.modules,
      atoms: meta.atoms,
      realms: meta.realms,
      roles: meta.roles,
      permissions: meta.permissions,
      envs: meta.envs,
    };
  }
}
