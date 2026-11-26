import { AlephaError, type ZType, z } from "alepha";

import { CAPABILITY_KEYS, type CapabilityKey } from "./capabilityKeySchema.ts";

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
   * Only `ship.track` is preselected: the capability's own label says "watch",
   * so Apps with tracking off would not do what the box the reader ticked says
   * it does. Board and Releases were on by default before this epic and are
   * deliberately not any more - a board is a way to look at quests, not a
   * reason to have them, and the same argument applied consistently takes
   * Releases with it.
   */
  preselected: boolean;
  /**
   * Offered in the creation wizard's setup step.
   *
   * Two filters decide this, and both must pass: the option has to change what
   * the project looks like on day one, and it has to be something we cannot
   * pick for the reader. **The wizard asks what surfaces exist; Settings asks
   * how you work.** So Board, Epics, Releases, Track and Deploy are here, and
   * `estimate` / `chrono` / `reminder` are not - those three are a methodology
   * adopted later, which their own doc already says.
   */
  wizard: boolean;
  /**
   * Rendered disabled, with a Soon badge, rather than hidden.
   *
   * ⚠️ **No option declares it today.** `ship.deploy` was the one, from epic
   * #36 until epic #1 shipped the surface behind it. The mechanism stays
   * because announcing a switch before it works is the right thing to do
   * again - the wizard is where somebody decides what Lore is for, and hiding
   * a planned surface means the reader who wants it never learns it is coming.
   */
  soon?: boolean;
  /**
   * Another option of the same capability this one only means anything
   * with: Settings draws it disabled while that one is off.
   */
  requires?: string;
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
  /**
   * The capability's name in English, for a refusal message.
   *
   * Deliberately beside {@link CapabilityDescriptor.labelKey} rather than
   * derived from it: a server error is not localized in this application (see
   * `EpicController`'s phase refusals), and a refusal that named a key rather
   * than a thing would send its reader looking for a switch called `work`.
   */
  name: string;
  labelKey: string;
  descriptionKey: string;
  /**
   * Ticked by default in the creation wizard's capability step, and part of
   * {@link CapabilityRegistry.defaultSet}.
   *
   * Work and Knowledge only. Apps and Support are off, which is exactly what
   * they were before this epic: `features.sigils` was absent from the defaults
   * and the wizard sent `feedback: false`.
   */
  preselectedCapability: boolean;
  /**
   * Where the wizard and Settings draw it: `general` above the pillars
   * (Activity, Chat, Reports, #Q4007), `pillar` for Plan, Remember and
   * Ship.
   */
  group: "general" | "pillar";
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
   * The option each MCP tool hangs off, for the tools that hang off one: a
   * call is refused while that option is off, and the assistant is not
   * offered the tool, exactly as {@link searchKindOptions} does for the
   * palette. Read through {@link CapabilityRegistry.isToolEnabled}.
   */
  mcpToolOptions?: Record<string, string>;
  /**
   * The `searchHitSchema` kinds the command palette may offer.
   */
  searchKinds: string[];
  /**
   * The option each search kind's surface hangs off, for the kinds that hang
   * off one: the palette offers such a kind only while that option is on,
   * exactly as {@link activityKindOptions} does for the feed and the sidebar
   * does for the entry. Read through
   * {@link CapabilityRegistry.isSearchKindEnabled}.
   *
   * ⚠️ The ROUTE stays unguarded (an option never guards a route), so a
   * saved `/epics/52` link keeps resolving; what an off option removes is
   * the palette offering it, the same thing it removes from the sidebar.
   */
  searchKindOptions?: Record<string, string>;
  /**
   * The audit `type` values the activity feed may show.
   */
  activityKinds: string[];
  /**
   * The option each activity kind's surface hangs off, for the kinds that
   * hang off one: the feed offers such a kind only while that option is on,
   * the same way the sidebar only shows its entry then.
   *
   * Declared beside {@link activityKinds} so the Activity filter and the row
   * narrowing both read it through {@link CapabilityRegistry.isActivityKindEnabled}
   * rather than a second hand-kept list. A kind with no entry here needs its
   * capability and nothing more, which is every kind outside Work today.
   */
  activityKindOptions?: Record<string, string>;
  /**
   * `DashboardMetricCatalog` keys the Add-card panel may offer.
   */
  dashboardCards: string[];
  /**
   * The `$permission` groups this capability owns.
   *
   * Declared here because `$permission` stays capability-agnostic - a second
   * consumer has no capabilities at all - so the capability
   * declaration is the only place the mapping can live. Ranks fills the
   * vocabulary and filters the rank matrix by it.
   */
  permissionGroups: string[];
}

/**
 * The capabilities a project composes, Lore's three pillars and Chat
 * (#E161), declared once.
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
 * Notifications are Core as well (#Q3892): their pages, permissions, MCP tools
 * and activity kind belong to no capability, and each event, selector and
 * preset declares the capability it needs.
 * Reports' tabs declare a capability the way dashboard cards do, because
 * Members is derived from a core table. Since #Q4007
 * the Activity PAGE and Reports each have a switch of their own (`activity`,
 * `reports`), on by default, that hides the page and owns nothing else: the
 * feed's data and the reports' API stay Core.
 *
 * Shaped after `DashboardMetricCatalog`, and for the same reason: a registry a
 * surface reads is one place to add a capability, where a hand-written `if`
 * chain is nine.
 */
export class CapabilityRegistry {
  protected readonly capabilities: CapabilityDescriptor[] = [
    {
      key: "plan",
      name: "Plan",
      labelKey: "project.capability.plan.label",
      descriptionKey: "project.capability.plan.description",
      group: "pillar",
      preselectedCapability: true,
      options: [
        {
          key: "epics",
          labelKey: "project.capability.plan.option.epics.label",
          descriptionKey: "project.capability.plan.option.epics.description",
          wizard: true,
          preselected: false,
        },
        {
          key: "releases",
          labelKey: "project.capability.plan.option.releases.label",
          descriptionKey: "project.capability.plan.option.releases.description",
          wizard: true,
          preselected: false,
        },
        {
          key: "estimate",
          labelKey: "project.capability.plan.option.estimate.label",
          descriptionKey: "project.capability.plan.option.estimate.description",
          wizard: false,
          preselected: false,
        },
        {
          key: "chrono",
          labelKey: "project.capability.plan.option.chrono.label",
          descriptionKey: "project.capability.plan.option.chrono.description",
          wizard: false,
          preselected: false,
        },
        {
          key: "reminder",
          labelKey: "project.capability.plan.option.reminder.label",
          descriptionKey: "project.capability.plan.option.reminder.description",
          wizard: false,
          preselected: false,
        },
        {
          // Support until #E143: the public request form, the triage inbox
          // and feedback comments, folded into Plan as one switch. Offered in
          // the wizard, never preselected, as the capability was not.
          key: "feedback",
          labelKey: "project.capability.plan.option.feedback.label",
          descriptionKey: "project.capability.plan.option.feedback.description",
          wizard: true,
          preselected: false,
        },
        {
          // Personas, use cases and requirements (#E153): a part of Plan, not
          // a capability of its own, whose code lives in
          // `@lore/plan-requirements`. Offered in the wizard and never
          // preselected, like Epics.
          key: "requirements",
          labelKey: "project.capability.plan.option.requirements.label",
          descriptionKey:
            "project.capability.plan.option.requirements.description",
          wizard: true,
          preselected: false,
        },
        {
          // Off by default: a release's readiness is a warning until a
          // project turns this on (#E153, #Q3774). A capability option reads
          // off when absent, which is exactly that.
          key: "blockFailingMust",
          labelKey: "project.capability.plan.option.blockFailingMust.label",
          descriptionKey:
            "project.capability.plan.option.blockFailingMust.description",
          wizard: false,
          preselected: false,
          requires: "requirements",
        },
        // A stored `automations` key (an option until #Q3594, removed with
        // automations in #Q3896) is stripped on read by the lax options
        // schema and dropped on the row's next write.
      ],
      // The notification tools are Core (#Q3895): owned by no capability,
      // like the dashboard, and each event is gated by its own `needs`.
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
        "area_delete",
        "quest_comment_add",
        "quest_commit_add",
        "quest_pull_request_add",
        "quest_attachment_add",
        "quest_attachment_get",
        "epic_list",
        "epic_get",
        "epic_create",
        "epic_update",
        "epic_set_status",
        "epic_pull_request_add",
        "epic_review_create",
        "epic_review_answer",
        "epic_shelve",
        "epic_unshelve",
        "epic_delete",
        "release_list",
        "release_get",
        "release_create",
        "release_update",
        "release_publish",
        "release_attach",
        "release_detach",
        "release_changelog",
        "release_delete",
        "feedback_list",
        "feedback_get",
        "feedback_accept",
        "feedback_reject",
        "feedback_comment_add",
        "feedback_attachment_get",
        // Plan's Requirements (#E153).
        "persona_list",
        "persona_get",
        "persona_create",
        "persona_update",
        "persona_delete",
        "persona_comment_add",
        "usecase_list",
        "usecase_get",
        "usecase_create",
        "usecase_update",
        "usecase_delete",
        "usecase_comment_add",
        "usecase_link_epic",
        "usecase_validate",
        "usecase_run_record",
        "usecase_run_attachment_add",
        "usecase_prompt",
        "requirement_list",
        "requirement_get",
        "requirement_create",
        "requirement_update",
        "requirement_delete",
        "requirement_set_release",
        "criterion_verify_link",
      ],
      mcpToolOptions: {
        feedback_list: "feedback",
        feedback_get: "feedback",
        feedback_accept: "feedback",
        feedback_reject: "feedback",
        feedback_comment_add: "feedback",
        feedback_attachment_get: "feedback",
        persona_list: "requirements",
        persona_get: "requirements",
        persona_create: "requirements",
        persona_update: "requirements",
        persona_delete: "requirements",
        persona_comment_add: "requirements",
        usecase_list: "requirements",
        usecase_get: "requirements",
        usecase_create: "requirements",
        usecase_update: "requirements",
        usecase_delete: "requirements",
        usecase_comment_add: "requirements",
        usecase_link_epic: "requirements",
        usecase_validate: "requirements",
        usecase_run_record: "requirements",
        usecase_run_attachment_add: "requirements",
        usecase_prompt: "requirements",
        requirement_list: "requirements",
        requirement_coverage: "requirements",
        requirement_get: "requirements",
        requirement_create: "requirements",
        requirement_update: "requirements",
        requirement_delete: "requirements",
        requirement_set_release: "requirements",
        criterion_verify_link: "requirements",
      },
      // Epics and releases are found by their number only (#Q2228), and
      // like their sidebar entries they hang off their Work options.
      // Feedback by number only too, and only for a caller holding
      // `feedback:read` (#Q2228): see `SearchController`.
      searchKinds: [
        "quest",
        "epic",
        "release",
        "feedback",
        "persona",
        "usecase",
        "requirement",
      ],
      searchKindOptions: {
        epic: "epics",
        release: "releases",
        feedback: "feedback",
        persona: "requirements",
        usecase: "requirements",
        requirement: "requirements",
      },
      activityKinds: [
        "quest",
        "epic",
        "release",
        "feedback",
        "persona",
        "usecase",
        "requirement",
      ],
      // Epics and Releases are options of Work, and so are their sidebar
      // entries (`capabilityNav.ts`). Quests are Plan's baseline.
      activityKindOptions: {
        epic: "epics",
        release: "releases",
        feedback: "feedback",
        persona: "requirements",
        usecase: "requirements",
        requirement: "requirements",
      },
      dashboardCards: [
        "activeQuests",
        "heldQuests",
        "epicProgress",
        "releaseProgress",
        "tagCompletion",
        // The flow tiles of #E77 (#Q2653).
        "burnup",
        "completedPerWeek",
        "completedThisWeek",
        "cycleTime",
        "questBreakdown",
        "boardColumns",
        // The plan tiles of #E77 (#Q2654).
        "releaseOutlook",
        "releasesToPublish",
        "epicsInFlight",
        "draftEpics",
        // The "your work" tiles of #E77 (#Q2655).
        "yourQuests",
        "remindersDue",
        "dueSoon",
        "recentlyShipped",
        "untriagedFeedback",
        // Plan's Requirements (#E153, #Q3775), each needing that option.
        "requirementCoverage",
        "releaseReadiness",
        "useCaseHealth",
        "requirementsToCover",
        "personaHealth",
        "requirementCoverageTrend",
      ],
      // Areas belong here: quests carry one, errors forward into one, and
      // `project_context` files them beside the epic index.
      permissionGroups: [
        "quest",
        "epic",
        "release",
        "area",
        "feedback",
        // Plan's Requirements (#E153).
        "persona",
        "usecase",
        "requirement",
      ],
    },
    {
      key: "remember",
      name: "Remember",
      labelKey: "project.capability.remember.label",
      descriptionKey: "project.capability.remember.description",
      group: "pillar",
      preselectedCapability: true,
      // None since #Q3704: the summary is edited from the Folio menu.
      options: [],
      mcpTools: [
        "folio_list",
        "folio_search",
        "folio_get",
        "folio_create",
        "folio_update",
        "folio_history",
        "folio_revert",
        "folio_delete",
        // A table folio's rows and columns (#E144).
        "folio_row_list",
        "folio_row_add",
        "folio_row_update",
        "folio_row_delete",
        "folio_column_set",
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
      dashboardCards: [
        // The Knowledge tiles of #E77 (#Q2658).
        "pinnedFolio",
        // The Folio card (#E144, #Q3520).
        "folio",
        "recentFolios",
        "foliosThisMonth",
        "foliosByDirectory",
      ],
      permissionGroups: ["folio"],
    },
    {
      key: "ship",
      name: "Ship",
      labelKey: "project.capability.ship.label",
      descriptionKey: "project.capability.ship.description",
      group: "pillar",
      preselectedCapability: false,
      options: [
        {
          key: "track",
          labelKey: "project.capability.ship.option.track.label",
          descriptionKey: "project.capability.ship.option.track.description",
          wizard: true,
          preselected: true,
        },
        // Monitor apps second (#Q4006): the order of dependence, Track,
        // Monitor, Deploy apps, Deploy stacks, which Settings, the wizard and
        // the CLI listing all read from here.
        {
          key: "uptime",
          labelKey: "project.capability.ship.option.uptime.label",
          descriptionKey: "project.capability.ship.option.uptime.description",
          wizard: true,
          preselected: false,
        },
        {
          key: "deploy",
          labelKey: "project.capability.ship.option.deploy.label",
          descriptionKey: "project.capability.ship.option.deploy.description",
          wizard: true,
          // ⚠️ NOT preselected, although the surface is real now. A project
          // that deploys through Lore is deploying into somebody's cloud
          // account; that is a thing to opt into on purpose, not a default a
          // wizard ticks on the way past. `soon: true` was here until epic #1
          // shipped, and the option's own doc promised its removal.
          preselected: false,
        },
        {
          // Stacks (#E79): off by default, like every other surface of Apps
          // but `track`, and switched beside its sidebar entry.
          key: "stacks",
          labelKey: "project.capability.ship.option.stacks.label",
          descriptionKey: "project.capability.ship.option.stacks.description",
          wizard: true,
          preselected: false,
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
        "error_list",
        "error_resolve",
        "error_forward",
        "sigil_list",
        "sigil_create",
        "sigil_rotate",
        "sigil_delete",
        "insights_read",
      ],
      searchKinds: [],
      // `monitor` is an uptime transition (#Q3596), shown with the
      // `uptime` option like the Uptime page itself.
      // `host` is Core since #E166: a host runs agent jobs and reports its
      // stats with Ship off.
      activityKinds: ["app", "sigil", "monitor"],
      activityKindOptions: { monitor: "uptime" },
      dashboardCards: [
        "openErrors",
        "uniqueVisitors",
        // The apps tiles of #E77 (#Q2657).
        "appHealth",
        "errorTrend",
        // How fast the pages feel (#Q4521).
        "webVitals",
        // The monitors (#Q3781); the hosts card is Core since #E166.
        "uptime",
        // Latency, certificates and incidents (#Q4426).
        "uptimeLatency",
        "certExpiry",
        "incidents",
      ],
      permissionGroups: [
        "app",
        // Epic #1's. Beside `app` rather than folded into it, because letting
        // somebody rename a copy is not the same act as letting them push code
        // into the host's cloud account.
        "deploy",
        "artifact",
        "error",
        "sigil",
        // `host` is Core since #E166 (#Q4115): hosts work with Ship off.
      ],
    },
    {
      // Chat (#E161): project rooms, members talking to each other and to
      // the agent. Neither on nor off by default: the creator chooses it in
      // the wizard, and a project that existed before it starts without it.
      key: "chat",
      name: "Chat",
      labelKey: "project.capability.chat.label",
      descriptionKey: "project.capability.chat.description",
      group: "general",
      preselectedCapability: false,
      options: [],
      mcpTools: ["chat_room_list", "chat_message_list", "chat_message_send"],
      // Rooms stay out of the spotlight in V1: a search source never sees
      // the user, and a private room must not exist for a non-member.
      searchKinds: [],
      activityKinds: [],
      dashboardCards: [],
      permissionGroups: ["chat"],
    },
    {
      // Prompts (#E175): the project's prompts, their triggers and pins, and
      // every agent job, built-ins included (quest work, plan review, feedback
      // triage, Requirements' verify runs). Off by default and never
      // preselected; a project that already used Prompts was given it by a
      // migration. The engine is `@lore/prompts`'; the `job_*` tools stay
      // Core, since a job is a host job and its history outlives the switch.
      key: "prompts",
      name: "Prompts",
      labelKey: "project.capability.prompts.label",
      descriptionKey: "project.capability.prompts.description",
      group: "general",
      preselectedCapability: false,
      options: [],
      mcpTools: [
        "prompt_list",
        "prompt_get",
        "prompt_create",
        "prompt_update",
        "prompt_duplicate",
        "prompt_delete",
        "prompt_render",
        "prompt_run",
        "prompt_pause_all",
        "prompt_resume_all",
        "agent_hosts",
      ],
      searchKinds: [],
      activityKinds: [],
      // The agent jobs in flight (#Q4342).
      dashboardCards: ["runningJobs"],
      permissionGroups: ["prompt"],
    },
    {
      // The Activity page and its sidebar entry (#Q4007), Core until then.
      // On by default, and every project that existed was given it by a
      // migration. Off hides the page (404) and the entry, nothing else: the
      // feed's data, `project_activity` over MCP and the CLI stay Core, an
      // agent's change feed must not depend on a page being shown.
      key: "activity",
      name: "Activity",
      labelKey: "project.capability.activity.label",
      descriptionKey: "project.capability.activity.description",
      preselectedCapability: true,
      group: "general",
      options: [],
      mcpTools: [],
      searchKinds: [],
      activityKinds: [],
      dashboardCards: [],
      permissionGroups: [],
    },
    {
      // Reports and its sidebar entry (#Q4007), Core until then, the same
      // way as Activity: on by default, migrated on, and off hides the page
      // and the entry. Each tab still declares the capability its data
      // needs; `project_report` stays Core.
      key: "reports",
      name: "Reports",
      labelKey: "project.capability.reports.label",
      descriptionKey: "project.capability.reports.description",
      preselectedCapability: true,
      group: "general",
      // Quality (#Q3070), Build's option until Build went (#Q4217): the
      // coverage CI pushes, its tab, tiles, event and permission group. A
      // quality PUSH is accepted whatever the switch says. Off by default,
      // like it was in Build; a project that had it kept it.
      options: [
        {
          key: "quality",
          labelKey: "project.capability.reports.option.quality.label",
          descriptionKey:
            "project.capability.reports.option.quality.description",
          wizard: false,
          preselected: false,
        },
      ],
      mcpTools: [],
      searchKinds: [],
      activityKinds: [],
      dashboardCards: [
        "qualityTrend",
        "quality.coverage.lines",
        "quality.coverage.statements",
        "quality.coverage.functions",
        "quality.coverage.branches",
        "quality.tests.total",
        "quality.tests.passed",
        "quality.tests.failed",
        "quality.tests.skipped",
      ],
      permissionGroups: ["quality"],
    },
  ];

  /**
   * The lax options schema of each capability, keyed the same way.
   *
   * Lax because it is what READS a stored row: a build with one option fewer
   * than the row it loads must strip the extra key, not throw. See
   * {@link strictOptionsOf} for the write side.
   *
   * Derived from each capability's declared `options`, every one a boolean
   * that reads `false` when absent, rather than imported from the module that
   * owns the capability: core reads no module's code (#E75, #Q2623). Each
   * module's own options schema (`planCapabilityOptionsSchema`...) types its
   * reads, and `test/capability-options-schemas.spec.ts` holds the two equal.
   */
  protected readonly optionSchemas: Record<CapabilityKey, ZType> =
    Object.fromEntries(
      this.capabilities.map((capability) => [
        capability.key,
        z.object(
          Object.fromEntries(
            capability.options.map((option) => [
              option.key,
              z.boolean().default(false),
            ]),
          ),
        ),
      ]),
    ) as unknown as Record<CapabilityKey, ZType>;

  /**
   * The same four schemas, closed, built once rather than per call.
   *
   * `.strict()` returns a new schema each time it is called, and this is on
   * the path of every capability write.
   */
  protected readonly strictOptionSchemas: Record<CapabilityKey, ZType> =
    Object.fromEntries(
      Object.entries(this.optionSchemas).map(([key, schema]) => [
        key,
        (schema as ReturnType<typeof z.object>).strict(),
      ]),
    ) as unknown as Record<CapabilityKey, ZType>;

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
   * `project_list`, `project_info`, `project_context`, `project_activity` and
   * `project_report` are Core and answer `undefined`: they describe the project
   * itself, and a project with no capabilities at all is a legal state that
   * must still be readable.
   */
  ownerOfTool(tool: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.mcpTools.includes(tool),
    )?.key;
  }

  /**
   * Whether an MCP tool may be called, given a project's enabled
   * capabilities and their options: the same rule as
   * {@link isActivityKindEnabled}. Core tools, owned by nobody, always pass.
   */
  isToolEnabled(
    tool: string,
    enabled: Partial<Record<CapabilityKey, Record<string, boolean>>>,
  ): boolean {
    const owner = this.ownerOfTool(tool);
    if (!owner) return true;
    const options = enabled[owner];
    if (!options) return false;
    const option = this.get(owner).mcpToolOptions?.[tool];
    return option === undefined || options[option] === true;
  }

  /**
   * Which capability owns an audit `type`, or `undefined` for a Core one.
   *
   * `member` and `project` answer `undefined` on purpose: both describe the
   * container rather than any surface inside it, and a project with no
   * capabilities at all still has members and still gets renamed. The
   * Activity feed is Core for the same reason - what it SHOWS is filtered,
   * the page itself never disappears.
   */
  ownerOfActivityKind(type: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.activityKinds.includes(type),
    )?.key;
  }

  /**
   * Whether the activity feed may show an audit `type`, given a project's
   * enabled capabilities and their options.
   *
   * Its capability must be on, and so must the option its surface hangs off
   * when {@link CapabilityDescriptor.activityKindOptions} names one: a Work
   * project with `epics` off has no Epics entry in its sidebar, so its feed
   * does not offer Epic either (feedback #P2177). Core kinds, owned by
   * nobody, always pass. Like a capability, an option that is off HIDES the
   * rows; it never deletes them.
   */
  isActivityKindEnabled(
    type: string,
    enabled: Partial<Record<CapabilityKey, Record<string, boolean>>>,
  ): boolean {
    const owner = this.ownerOfActivityKind(type);
    if (!owner) return true;
    const options = enabled[owner];
    if (!options) return false;
    const option = this.get(owner).activityKindOptions?.[type];
    return option === undefined || options[option] === true;
  }

  /**
   * Whether the command palette may offer a `searchHitSchema` kind, given a
   * project's enabled capabilities and their options.
   *
   * The same rule as {@link isActivityKindEnabled}: its capability must be
   * on, and so must the option its surface hangs off when
   * {@link CapabilityDescriptor.searchKindOptions} names one, so a Work
   * project with `epics` off finds no epic by number either (#Q2228).
   */
  isSearchKindEnabled(
    kind: string,
    enabled: Partial<Record<CapabilityKey, Record<string, boolean>>>,
  ): boolean {
    const owner = this.ownerOfSearchKind(kind);
    if (!owner) return true;
    const options = enabled[owner];
    if (!options) return false;
    const option = this.get(owner).searchKindOptions?.[kind];
    return option === undefined || options[option] === true;
  }

  /**
   * Which capability owns a `searchHitSchema` kind, or `undefined` for a
   * Core one. Nothing is Core today; the shape matches its two siblings so a
   * future Core kind needs no new branch.
   */
  ownerOfSearchKind(kind: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.searchKinds.includes(kind),
    )?.key;
  }

  /**
   * Which capability owns a `DashboardMetricCatalog` key, or `undefined`.
   *
   * ⚠️ The catalogue carries the same fact on each metric's `needs`, because
   * a card can additionally require an OPTION (`openErrors` needs
   * `ship.track`, not merely `apps`) and this list has no room to say so.
   * `dashboard-capabilities.spec.ts` pins the two together: every metric's
   * `needs.capability` must be the capability that claims it here, and every
   * key claimed here must exist in the catalogue.
   */
  ownerOfDashboardCard(key: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.dashboardCards.includes(key),
    )?.key;
  }

  /**
   * Which capability owns a `$permission` group, or `undefined` for a Core
   * one.
   *
   * The fifth of these lookups, and the last of the mappings to grow a
   * reverse: `permissionGroups` shipped with #E36 and only ever read forwards.
   * The rank matrix reads it backwards - given a group, should this section
   * render at all - which is a different question and the one that decides
   * whether a permission is offerable.
   *
   * `project`, `member`, `rank`, `capability`, `invitation`, `stats` and
   * `host` (since #E166) answer
   * `undefined` on purpose: they describe the container rather than a surface
   * inside it, and a project with no capabilities at all still has members,
   * still gets renamed and still has ranks to edit.
   *
   * ⚠️ A group claimed by nothing and named nowhere as Core would be
   * **invisible in the matrix while still gating endpoints**.
   * `capability-permission-groups.spec.ts` pins that it cannot happen.
   */
  ownerOfPermissionGroup(group: string): CapabilityKey | undefined {
    return this.capabilities.find((capability) =>
      capability.permissionGroups.includes(group),
    )?.key;
  }

  /**
   * Whether a surface owned by `owner` is on, given the enabled set.
   *
   * `undefined` is Core and always true - that single line is what keeps the
   * three composing surfaces (dashboard, activity, palette) from growing a
   * branch per capability.
   */
  isOwnerEnabled(
    owner: CapabilityKey | undefined,
    enabled: Iterable<CapabilityKey>,
  ): boolean {
    if (!owner) return true;
    for (const key of enabled) {
      if (key === owner) return true;
    }
    return false;
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
  /**
   * The keys of `raw` this capability does not declare as options, for a
   * writer to refuse with their names before it calls
   * {@link strictOptionsOf}, which throws a bare `ZodError` on them (#Q4194).
   */
  unknownOptionsOf(key: CapabilityKey, raw?: unknown): string[] {
    if (!raw || typeof raw !== "object") return [];
    const known = new Set(this.get(key).options.map((option) => option.key));
    return Object.keys(raw).filter((option) => !known.has(option));
  }

  strictOptionsOf(key: CapabilityKey, raw?: unknown): Record<string, boolean> {
    return this.strictOptionSchemas[key].parse(raw ?? {}) as Record<
      string,
      boolean
    >;
  }

  /**
   * The options this capability offers in the creation wizard's setup step.
   *
   * A capability with none contributes no section, which is what lets a
   * Remember-only project skip the step entirely.
   */
  wizardOptionsOf(key: CapabilityKey): CapabilityOptionDescriptor[] {
    return this.get(key).options.filter((option) => option.wizard);
  }

  /**
   * What a project gets when the caller says nothing about capabilities.
   *
   * The wizard's own preselection - Work and Knowledge on, each with its
   * preselected options - so `createProject` with no `capabilities` field
   * produces the project the wizard would have made.
   *
   * ⚠️ Derived from the declarations rather than written out, so a fifth
   * capability decides for itself whether it is in the default set by
   * declaring `preselectedCapability`. A second list would rot against the
   * first the way every second list does.
   */
  defaultSet(): Array<{
    key: CapabilityKey;
    options: Record<string, boolean>;
  }> {
    return this.capabilities
      .filter((capability) => capability.preselectedCapability)
      .map((capability) => ({
        key: capability.key,
        options: this.preselectedOptionsOf(capability.key),
      }));
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
