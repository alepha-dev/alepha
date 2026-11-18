import { AlephaError } from "alepha";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";

/**
 * Every event a project can emit, registered by the package that owns it
 * (#Q3889): Plan registers the quest, epic, release and feedback events, Ship
 * the deploy, monitor and host events. Delivery, the Notifications page,
 * `event_catalog` and `event_list` all read this one list.
 */
export class ProjectEventCatalog {
  protected readonly definitions = new Map<string, ProjectEventDefinition>();

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
   * exist there.
   */
  needs: { capability: CapabilityKey; option?: string };
  /**
   * The permission a reader needs, at delivery and in `event_list`.
   */
  permission: string;
  /**
   * The field a subscription's filter matches, and the resource its value
   * names: the app of a deployment, not the deployment.
   */
  filter?: { field: string; resource: "host" | "app" | "monitor" };
}
