import { $inject, AlephaError, z } from "alepha";
import { $webhook, WebhookService } from "alepha/api/webhooks";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import type { ProjectEventFields } from "../schemas/projectEventFieldsSchema.ts";

/**
 * Every event a project can emit, registered by the package that owns it
 * (#Q3889): Plan registers the quest, epic, release and feedback events, Ship
 * the deploy, monitor and host events. Delivery, the Notifications page,
 * `event_catalog` and `event_list` all read this one list.
 */
export class ProjectEventCatalog {
  /**
   * What a webhook channel receives as `data` (#Q3900): the project, the
   * subject, the event's fields and its link.
   */
  public static readonly WEBHOOK_DATA = z.object({
    project: z.object({ id: z.integer(), title: z.string() }),
    subject: z.object({ kind: z.string(), id: z.string().nullable() }),
    fields: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    url: z.string(),
  });

  protected readonly definitions = new Map<string, ProjectEventDefinition>();
  protected readonly webhooks = $inject(WebhookService);

  public register(definition: ProjectEventDefinition): void {
    if (this.definitions.has(definition.name))
      throw new AlephaError(
        `Project event '${definition.name}' is registered twice: one package owns each event`,
      );
    if (definition.filter && !(definition.filter.field in definition.fields))
      throw new AlephaError(
        `Project event '${definition.name}' filters on '${definition.filter.field}', which it does not carry`,
      );
    this.definitions.set(definition.name, definition);
    // Declared to the framework as a `$webhook` (#Q3900), so its catalog
    // and OpenAPI describe it. A name the framework's convention refuses
    // (`host.credential_invalid` has an underscore) is still delivered
    // under its own name, only not declared.
    // Registered by hand: a primitive created outside a class field gets
    // no init of its own.
    if (this.webhooks.namePattern.test(definition.name))
      this.webhooks.register(
        $webhook({
          name: definition.name,
          description: `${definition.label}, in a Lore project.`,
          schema: ProjectEventCatalog.WEBHOOK_DATA,
        }) as never,
      );
  }

  public all(): ProjectEventDefinition[] {
    return [...this.definitions.values()];
  }

  public find(name: string): ProjectEventDefinition | undefined {
    return this.definitions.get(name);
  }

  public get(name: string): ProjectEventDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new AlephaError(`Unknown project event '${name}'`);
    return definition;
  }
}

/**
 * The kind of value an event field holds. `member` is a user id.
 */
export type ProjectEventFieldKind = "text" | "number" | "boolean" | "member";

/**
 * The resource an event is grouped under on the Notifications page.
 */
export type ProjectEventResource =
  | "quests"
  | "epics"
  | "releases"
  | "feedback"
  | "errors"
  | "quality"
  | "apps"
  | "monitors"
  | "hosts";

export interface ProjectEventDefinition {
  /**
   * `host.offline`: resource, then what happened to it.
   */
  name: string;
  /**
   * The English label the CLI and MCP print. The web page has its own
   * translated label per event.
   */
  label: string;
  resource: ProjectEventResource;
  /**
   * The kind of resource the event is about, stored as its subject.
   */
  subject: string;
  /**
   * Every field the event carries. A field not declared here is dropped on
   * emit; `project`, `title` and `url` are common to every event.
   */
  fields: Record<string, ProjectEventFieldKind>;
  /**
   * The capability (and option of it) a project needs for the event to
   * exist there. Absent on a Core event, which every project has: the host
   * events since #E166.
   */
  needs?: { capability: CapabilityKey; option?: string };
  /**
   * The permission a reader needs, at delivery and in `event_list`.
   */
  permission: string;
  /**
   * The field a subscription's filter matches, and the resource its value
   * names: the app of a deployment, not the deployment.
   */
  filter?: { field: string; resource: "host" | "app" | "monitor" };
  /**
   * The event's fixed message (#Q3890), rendered from its fields: a title
   * (the inbox line, the email subject) and one sentence of text. No user
   * text and no placeholders. Takes the language so French lands the day
   * a recipient has one; English only for now.
   */
  message: (fields: ProjectEventFields, lang: string) => ProjectEventMessage;
}

export interface ProjectEventMessage {
  title: string;
  text: string;
}
