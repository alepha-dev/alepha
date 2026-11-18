import type { ProjectEventController } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore event catalog` and `lore event list` (#Q3895): the events a project
 * can emit, and the ones it recently did. A schedule or a multi-step
 * reaction is not in Lore: use a scheduled agent session, or a webhook.
 */
export class EventCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<ProjectEventController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly catalog = $command({
    name: "catalog",
    description:
      "The events this project can emit, with their fields, the capability each needs and why an unavailable one is unavailable",
    flags: z.object({ ...EventCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.api.getProjectEventCatalog({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }
        this.render.list(
          print,
          page.items.map((event) => ({
            handle: event.name,
            title: event.label,
            fields: [
              event.available ? "available" : (event.reason ?? "unavailable"),
              `${event.permission}${event.filter ? `, filter: ${event.filter.field}` : ""}`,
            ],
          })),
          undefined,
          "No events.",
        );
      });
    },
  });

  public readonly list = $command({
    name: "list",
    description:
      "The recent events of a project, newest first, to check that one fired",
    flags: z.object({
      ...EventCommand.PROJECT_FLAG,
      name: z
        .text({ description: "Only this event (host.offline)." })
        .optional(),
      subject: z
        .text({ description: "Only events about this subject id." })
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("At most this many.")
        .optional(),
      offset: z
        .integer()
        .min(0)
        .max(10_000)
        .describe("Skip this many.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.api.listProjectEvents({
          params: { projectId },
          query: {
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.subject ? { subject: flags.subject } : {}),
            ...(flags.limit ? { limit: flags.limit } : {}),
            ...(flags.offset ? { offset: flags.offset } : {}),
          },
        });
        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }
        this.render.list(
          print,
          page.items.map((event) => ({
            handle: event.name,
            title: String(event.fields.title ?? event.subjectId ?? ""),
            fields: [event.occurredAt],
          })),
          undefined,
          "No events.",
        );
      });
    },
  });

  public readonly event = $command({
    name: "event",
    description:
      "A project's events: what it can emit, and what it recently did",
    children: [this.catalog, this.list],
    handler: async ({ help }) => {
      help();
    },
  });
}
