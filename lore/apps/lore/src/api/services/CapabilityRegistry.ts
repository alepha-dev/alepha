import { AlephaError, type ZType } from "alepha";

import { appsCapabilityOptionsSchema } from "../schemas/appsCapabilityOptionsSchema.ts";
import {
  CAPABILITY_KEYS,
  type CapabilityKey,
} from "../schemas/capabilityKeySchema.ts";
import { knowledgeCapabilityOptionsSchema } from "../schemas/knowledgeCapabilityOptionsSchema.ts";
import { supportCapabilityOptionsSchema } from "../schemas/supportCapabilityOptionsSchema.ts";
import { workCapabilityOptionsSchema } from "../schemas/workCapabilityOptionsSchema.ts";

/**
 * One switch inside a capability.
 */
export interface CapabilityOptionDescriptor {
  /**
   * Persisted key, inside the capability row's `options`. Opaque and
   * permanent, like the capability key itself.
   */
  key: string;
  labelKey: string;
  descriptionKey: string;
  /**
   * Checked by default in the creation wizard.
   *
   * ⚠️ **Not the same thing as what an absent key reads as.** Absent always
   * reads as `false` (the options schemas encode it), because a row written
   * before an option existed never said anything about it. This applies once,
   * at creation, to a person who is being asked.
   *
   * Only `apps.track` is preselected: the capability's own label says "watch",
   * so Apps with tracking off would not do what the box the reader ticked says
   * it does. Board and Releases were on by default before this epic and are
   * deliberately not any more - a board is a way to look at quests, not a
   * reason to have them, and the same argument applied consistently takes
   * Releases with it.
   */
  preselected: boolean;
  /**
   * Rendered disabled, with a Soon badge, rather than hidden.
   */
  soon?: boolean;
}

/**
 * Everything about one capability except how any of it is drawn.
 *
 * Icons are React elements and route names are web-side, so the nav entries,
 * the route lists and the settings sections keyed by the same enum live in the
 * web tree. This file must stay importable by the browser, which is also why
 * it holds no repository.
 */
export interface CapabilityDescriptor {
  key: CapabilityKey;
  labelKey: string;
  descriptionKey: string;
  options: CapabilityOptionDescriptor[];
  /**
   * The MCP tools this capability owns. A call into one of them, on a project
   * that has the capability off, is refused with a 400 naming the capability.
   *
   * Tool **listing** stays global: tools take a project parameter and the list
   * is per-connection, so the gate is on the call.
   */
  mcpTools: string[];
  /**
   * The `searchHitSchema` kinds the command palette may offer.
   */
  searchKinds: string[];
  /**
   * The audit `type` values the activity feed may show.
   */
  activityKinds: string[];
  /**
   * `DashboardMetricCatalog` keys the Add-card panel may offer.
   */
  dashboardCards: string[];
  /**
   * The `$permission` groups this capability owns.
   *
   * Declared here because `$permission` stays capability-agnostic - Alepha
   * Club is a second consumer with no capabilities at all - so the capability
   * declaration is the only place the mapping can live. Ranks fills the
   * vocabulary and filters the rank matrix by it.
   */
  permissionGroups: string[];
}

/**
 * The four capabilities a project composes, declared once.
 *
 * A **capability** is a product surface a project turns on: it owns nav
 * entries, routes, entities, MCP tools, a settings page, dashboard cards,
 * search kinds, activity kinds and permissions. That is the question the
 * creation wizard asks. An **option** is a switch inside one, and lives on
 * that capability's settings page. `projects.features` conflated the two,
 * which is the root cause of everything this epic is fixing: `sigils` gated
 * three unrelated surfaces, `kanban` gated a *view* of quests, and quests had
 * no flag at all.
 *
 * Everything not claimed below is **Core** and always on: project identity,
 * members, areas' storage, settings, and the three surfaces that *compose*
 * capabilities - the dashboard, the activity feed and the command palette.
 * Reports is Core too, and its tabs declare a capability the way dashboard
 * cards do, because Quality is Apps baseline and Members is derived from a
 * core table: an Apps-only project needs Reports to reach its own Quality tab.
 *
 * Shaped after `DashboardMetricCatalog`, and for the same reason: a registry a
 * surface reads is one place to add a capability, where a hand-written `if`
 * chain is nine.
 */
export class CapabilityRegistry {
  protected readonly capabilities: CapabilityDescriptor[] = [
    {
      key: "work",
      labelKey: "project.capability.work.label",
      descriptionKey: "project.capability.work.description",
      options: [
        {
          key: "board",
          labelKey: "project.capability.work.option.board.label",
          descriptionKey: "project.capability.work.option.board.description",
          preselected: false,
        },
        {
          key: "epics",
          labelKey: "project.capability.work.option.epics.label",
          descriptionKey: "project.capability.work.option.epics.description",
          preselected: false,
        },
        {
          key: "releases",
          labelKey: "project.capability.work.option.releases.label",
          descriptionKey: "project.capability.work.option.releases.description",
          preselected: false,
        },
        {
          key: "estimate",
          labelKey: "project.capability.work.option.estimate.label",
          descriptionKey: "project.capability.work.option.estimate.description",
          preselected: false,
        },
        {
          key: "chrono",
          labelKey: "project.capability.work.option.chrono.label",
          descriptionKey: "project.capability.work.option.chrono.description",
          preselected: false,
        },
        {
          key: "reminder",
          labelKey: "project.capability.work.option.reminder.label",
          descriptionKey: "project.capability.work.option.reminder.description",
          preselected: false,
        },
      ],
      mcpTools: [
        "quest_list",
        "quest_get",
        "quest_create",
        "quest_update",
        "quest_delete",
        "quest_accept",
        "quest_complete",
        "quest_shelve",
        "quest_unshelve",
        "quest_unassign",
        "quest_objective_set",
        "quest_tags",
        "quest_comment_add",
        "quest_commit_add",
        "quest_attachment_add",
        "quest_attachment_get",
        "epic_list",
        "epic_get",
        "epic_create",
        "epic_update",
        "epic_set_status",
        "epic_delete",
        "release_list",
        "release_get",
        "release_create",
        "release_update",
        "release_publish",
        "release_reopen",
        "release_attach",
        "release_detach",
        "release_changelog",
        "release_delete",
      ],
      searchKinds: ["quest"],
      activityKinds: ["quest", "epic", "release"],
      dashboardCards: ["activeQuests"],
      // Areas belong here: quests carry one, blights forward into one, and
      // `project_context` files them beside the epic index.
      permissionGroups: ["quest", "epic", "release", "area"],
    },
    {
      key: "knowledge",
      labelKey: "project.capability.knowledge.label",
      descriptionKey: "project.capability.knowledge.description",
      options: [
        {
          key: "agentSummary",
          labelKey: "project.capability.knowledge.option.agentSummary.label",
          descriptionKey:
            "project.capability.knowledge.option.agentSummary.description",
          preselected: false,
        },
      ],
      mcpTools: [
        "folio_list",
        "folio_search",
        "folio_get",
        "folio_create",
        "folio_update",
        "folio_history",
        "folio_revert",
        "folio_delete",
        "folio_attachment_add",
        "folio_attachment_list",
        "folio_attachment_rename",
        "folio_attachment_delete",
        "directory_list",
        "directory_create",
        "directory_rename",
        "directory_move",
        "directory_delete",
      ],
      searchKinds: ["folio", "directory"],
      activityKinds: ["folio"],
      dashboardCards: [],
      permissionGroups: ["folio"],
    },
    {
      key: "apps",
      labelKey: "project.capability.apps.label",
      descriptionKey: "project.capability.apps.description",
      options: [
        {
          key: "track",
          labelKey: "project.capability.apps.option.track.label",
          descriptionKey: "project.capability.apps.option.track.description",
          preselected: true,
        },
        {
          key: "deploy",
          labelKey: "project.capability.apps.option.deploy.label",
          descriptionKey: "project.capability.apps.option.deploy.description",
          preselected: false,
          soon: true,
        },
      ],
      mcpTools: [
        "app_instance_list",
        "app_instance_get",
        "app_instance_create",
        "app_instance_update",
        "app_instance_delete",
        "artifact_list",
        "artifact_get",
        "blight_list",
        "blight_resolve",
        "blight_forward",
        "sigil_list",
        "sigil_create",
        "sigil_rotate",
        "sigil_delete",
        "insights_read",
      ],
      searchKinds: [],
      activityKinds: ["app", "sigil", "estate"],
      dashboardCards: ["openBlights", "uniqueVisitors"],
      permissionGroups: [
        "app",
        "artifact",
        "blight",
        "quality",
        "sigil",
        "estate",
      ],
    },
    {
      key: "support",
      labelKey: "project.capability.support.label",
      descriptionKey: "project.capability.support.description",
      options: [],
      mcpTools: [
        "feedback_list",
        "feedback_get",
        "feedback_accept",
        "feedback_reject",
        "feedback_comment_add",
        "feedback_attachment_get",
      ],
      searchKinds: [],
      activityKinds: ["feedback"],
      dashboardCards: ["untriagedFeedback"],
      permissionGroups: ["feedback"],
    },
  ];

  /**
   * The lax options schema of each capability, keyed the same way.
   *
   * Lax because it is what READS a stored row: a build with one option fewer
   * than the row it loads must strip the extra key, not throw. See
   * {@link strictOptionsOf} for the write side.
   */
  protected readonly optionSchemas = {
    work: workCapabilityOptionsSchema,
    knowledge: knowledgeCapabilityOptionsSchema,
    apps: appsCapabilityOptionsSchema,
    support: supportCapabilityOptionsSchema,
  } satisfies Record<CapabilityKey, ZType>;

  /**
   * The same four schemas, closed, built once rather than per call.
   *
   * `.strict()` returns a new schema each time it is called, and this is on
   * the path of every capability write.
   */
  protected readonly strictOptionSchemas: Record<CapabilityKey, ZType> = {
    work: workCapabilityOptionsSchema.strict(),
    knowledge: knowledgeCapabilityOptionsSchema.strict(),
    apps: appsCapabilityOptionsSchema.strict(),
    support: supportCapabilityOptionsSchema.strict(),
  };

  /**
   * Every capability, in the order the wizard and Settings present them.
   */
  all(): CapabilityDescriptor[] {
    return this.capabilities;
  }

  /**
   * One capability, or `undefined` for a key this build does not know.
   */
  find(key: string): CapabilityDescriptor | undefined {
    return this.capabilities.find((capability) => capability.key === key);
  }

  /**
   * One capability, or a thrown error. Use where an unknown key is a bug.
   */
  get(key: string): CapabilityDescriptor {
    const capability = this.find(key);
    if (!capability) {
      throw new AlephaError(`Unknown capability: ${key}`);
    }
    return capability;
  }

  /**
   * Which capability owns an MCP tool, or `undefined` for a Core tool.
   *
   * `project_list`, `project_info`, `project_context` and `project_activity`
   * are Core and answer `undefined`: they describe the project itself, and a
   * project with no capabilities at all is a legal state that must still be
   * readable.
   */
  ownerOfTool(tool: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.mcpTools.includes(tool),
    )?.key;
  }

  /**
   * The stored options of a capability, defaults filled in.
   *
   * Every option that is not in `raw` comes back `false`, which is the read
   * rule of this whole epic: a row written before an option existed never said
   * anything about it, and the only safe reading of silence is off. Unknown
   * keys are stripped rather than refused - see {@link strictOptionsOf}.
   */
  optionsOf(key: CapabilityKey, raw?: unknown): Record<string, boolean> {
    return this.optionSchemas[key].parse(raw ?? {}) as Record<string, boolean>;
  }

  /**
   * The same schema, closed: an unknown key is refused rather than stripped.
   *
   * For the write path only. `createProject`'s body schema is `.partial()`, so
   * a mistyped feature key has been accepted silently for as long as
   * `projects.features` has existed, and its own comment says so. A capability
   * write is the chance to make that loud, and it is only loud on the way in:
   * doing the same on the way out would turn a forward-compatible row into an
   * unreadable one.
   */
  strictOptionsOf(key: CapabilityKey, raw?: unknown): Record<string, boolean> {
    return this.strictOptionSchemas[key].parse(raw ?? {}) as Record<
      string,
      boolean
    >;
  }

  /**
   * What the creation wizard starts a capability's options at.
   */
  preselectedOptionsOf(key: CapabilityKey): Record<string, boolean> {
    const options: Record<string, boolean> = {};
    for (const option of this.get(key).options) {
      options[option.key] = option.preselected;
    }
    return options;
  }

  /**
   * Every capability key, in declaration order.
   *
   * Reads from the schema's own list rather than from
   * {@link CapabilityRegistry.capabilities}, so a key declared without a
   * descriptor is a type error rather than an entry that quietly disappears
   * from the wizard.
   */
  keys(): readonly CapabilityKey[] {
    return CAPABILITY_KEYS;
  }
}
