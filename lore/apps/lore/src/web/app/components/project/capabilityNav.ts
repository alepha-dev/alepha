import {
  Activity,
  AppWindow,
  BarChart3,
  BookOpen,
  Bug,
  Columns3,
  Flag,
  Grid3x2,
  Inbox,
  Layers,
  Package,
  PauseCircle,
} from "lucide-react";

import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";

/**
 * What a nav entry needs to know besides its own declaration.
 */
export interface CapabilityNavContext {
  /**
   * `$page` name of the route currently open.
   */
  routeName: string;
  /**
   * The query the open route carries, so an entry addressing a filtered view
   * of another entry's page can tell whether it is the one being looked at.
   */
  routeQuery?: Record<string, string>;
  questCount?: number;
  heldQuestCount?: number;
  epicCount?: number;
  feedbackCount?: number;
  blightCount?: number;
  /**
   * Unread messages **in this project**, not everywhere.
   *
   * ⚠️ The header bell counts every project you belong to and reads a
   * different atom. The two legitimately disagree, and the names are the
   * only thing keeping them apart.
   */
  /**
   * True when some deployed copy in this project currently carries the
   * `blights` kind.
   */
  collectsBlights: boolean;
}

/**
 * One sidebar destination, declared rather than written as an `if`.
 */
export interface CapabilityNavEntry {
  /**
   * `$page` name. ⚠️ A plain string: route names are not typecheck-protected
   * here, so renaming one is a grep job. `app-routes.spec.ts` resolves every
   * name a nav array carries and is what turns a rename into a red test.
   */
  route: string;
  /**
   * Query the entry's link carries, for a destination that is a FILTERED view
   * of another entry's page rather than a page of its own.
   *
   * ⚠️ It also decides the highlight: an entry with a query lights up only
   * when the open route carries the same values, or On hold would be
   * highlighted on every quests page. The entry it shares a route with keeps
   * lighting up too, and that is right - one is the page, the other is a view
   * inside it, and a sidebar that dropped the parent would say the reader had
   * left Quests.
   */
  query?: Record<string, string>;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Which of the sidebar's bands this sits in.
   */
  group: "activity" | "work" | "record" | "ops";
  /**
   * Position within the band, ascending.
   *
   * ⚠️ Explicit, because the band's order is NOT the capability enum's.
   * Record reads Folios, Releases, Reports - one from Knowledge, one from
   * Work, one from Core - and sorting by whichever capability was declared
   * first would put Reports at the top. The numbers are spaced so an entry
   * can be inserted without renumbering its neighbours.
   */
  order: number;
  /**
   * The option inside the capability this entry hangs off. Absent means the
   * capability alone decides.
   */
  option?: string;
  /**
   * Route names that light this entry up, beyond its own.
   */
  activeOn?: (routeName: string) => boolean;
  badge?: (context: CapabilityNavContext) => number | undefined;
  /**
   * A last say beyond the capability and the option, for an entry that hides
   * itself on DATA. Only Blights has one.
   */
  available?: (context: CapabilityNavContext) => boolean;

  /**
   * The permission that OPENS this destination.
   *
   * Filtered here rather than at the page, because a nav entry leading to a
   * 403 is worse than no entry: it advertises a place the reader cannot go.
   * The page's own loader refuses too - this is not enforcement, and a hidden
   * entry never was.
   *
   * Absent means the capability alone decides, which is right for Activity:
   * every rank holds `project:read`, so gating it would be a check that can
   * never fail.
   */
  permission?: string;
}

/**
 * The sidebar, as data.
 *
 * `ProjectView` built this with a chain of nine `if (features.x)`, and
 * `projectNavAtom` then read that chain's OUTPUT so the palette could not
 * disagree with it. The chain is gone; the property that made it correct is
 * kept, because the palette still reads one computation.
 *
 * ⚠️ **This map is the nav model, and the framework one is not coming.**
 * `projectNavAtom`'s doc used to defer to `$page` nav metadata as the better
 * end state. It is not: `PageNav` is static and `can()` receives only
 * `{ has }`, so it cannot express per-project state, an atom-driven badge, or
 * an entry that hides itself on data. Ranks shelved that quest on 2026-09-06
 * and adds the caller's rank set here instead, as a second input to the same
 * computation - which is why every entry is a plain data object with room for
 * the permission it opens on, and why there must not be a second map.
 *
 * Icons and route names live here rather than in `CapabilityRegistry` for the
 * reason that registry gives: an icon is a React element and a route name is
 * not a server concept. Both halves are keyed by the same enum.
 */
export const CAPABILITY_NAV: Record<CapabilityKey, CapabilityNavEntry[]> = {
  work: [
    {
      route: "projectQuests",
      permission: "quest:read",
      labelKey: "project.menu.quests",
      icon: Grid3x2,
      group: "work",
      order: 10,
      // Highlighted from anywhere under Quests, not just the list: opening a
      // quest used to clear the sidebar entirely, so the one page you were
      // deepest inside was the one that said where you were not.
      activeOn: (name) =>
        name === "projectQuests" ||
        name === "project" ||
        name === "projectQuest" ||
        name === "projectQuestGraph",
      badge: (ctx) => ctx.questCount || undefined,
    },
    {
      /**
       * The quests waiting on somebody, reported as "one place listing what
       * is blocked, so I do not have to remember to go looking for it".
       *
       * A filtered view of the quests list rather than a page of its own:
       * `?status=held` is already linkable (`fromQuery` on that table), so
       * this is a destination that needed no route.
       *
       * ⚠️ **The label is "On hold", not "Waiting on you", and that is a
       * decision rather than a wording choice.** A hold has no direction
       * today: "blocked on a decision from the owner" and "blocked on a
       * deploy window" are the same status, and the reason lands in the
       * quest's Discussion as a comment. Naming a person the data cannot
       * name would be a promise the badge does not keep. Giving a hold a
       * direction - a mention, or a `heldFor` member reference - is a
       * separate change, and this entry is what it would hang off either
       * way.
       */
      route: "projectQuests",
      query: { status: "held" },
      permission: "quest:read",
      labelKey: "project.menu.held",
      icon: PauseCircle,
      group: "work",
      order: 15,
      badge: (ctx) => ctx.heldQuestCount || undefined,
    },
    {
      // A destination, so it gets an entry of its own. It had one until the
      // 2026-08 rename took it, which is why `ProjectQuestsViewSwitcher` had
      // to be invented - the board was unreachable from the UI at all.
      route: "projectKanban",
      permission: "quest:read",
      labelKey: "project.menu.kanban",
      icon: Columns3,
      group: "work",
      order: 20,
      option: "board",
    },
    {
      // A lens on quests, so it sits right after them: scope, then the items.
      route: "projectEpics",
      permission: "epic:read",
      labelKey: "project.menu.epics",
      icon: Layers,
      group: "work",
      order: 30,
      option: "epics",
      activeOn: (name) => name === "projectEpics" || name === "projectEpic",
      // Planned epics only. A planned epic is a gate holding its quests out
      // of the Quests count beside it, so this is the sidebar's only trace of
      // that work.
      badge: (ctx) => ctx.epicCount || undefined,
    },
    {
      // Between Folios and Reports.
      route: "projectReleases",
      permission: "release:read",
      labelKey: "project.menu.releases",
      icon: Flag,
      group: "record",
      order: 20,
      option: "releases",
      activeOn: (name) =>
        name === "projectReleases" || name === "projectRelease",
    },
  ],
  knowledge: [
    {
      route: "projectFolios",
      permission: "folio:read",
      labelKey: "project.menu.folios",
      icon: BookOpen,
      group: "record",
      order: 10,
      activeOn: (name) => name.startsWith("projectFolios"),
    },
  ],
  apps: [
    {
      // ONE entry, pointing at the list. It was a disclosure group with one
      // child per enrolled app; once an instance is something you create
      // freely, that is a list growing without bound in the one piece of
      // chrome that must not.
      route: "projectApps",
      permission: "app:read",
      labelKey: "project.menu.apps",
      icon: AppWindow,
      group: "ops",
      order: 10,
      // ⚠️ BASELINE, with no option. Instances, artifacts and quality are
      // there whenever Apps is on; `track` adds telemetry to them. Gating
      // this entry on `track` would leave a project that deploys elsewhere
      // with no way to reach the copies it has recorded.
    },
    {
      // ⚠️ Baseline, with no option: artifacts arrive from CI through
      // `lore artifacts push`, not from anything an instance collects, so a
      // project that watches nothing still has a build history and still
      // needs the door to it. It moved under Apps on 2026-09-06 at the
      // owner's request - an artifact is a build OF AN APP.
      route: "projectArtifacts",
      permission: "artifact:read",
      labelKey: "project.menu.artifacts",
      icon: Package,
      group: "ops",
      order: 20,
    },
    {
      // Blights are reported by apps, so the entry appears once some enrolled
      // app carries the capability, and goes when the last one drops it.
      //
      // ...unless blights are already filed. They outlive the app that
      // reported them (`blights.sigilId` is `ON DELETE SET NULL`) and stay for
      // the retention window, so an owner who deletes their only app would
      // otherwise lose the only way into an inbox that still holds open
      // crashes. A project that never collected one still shows no entry,
      // which is the property this predicate exists for.
      route: "projectBlights",
      permission: "blight:read",
      labelKey: "project.menu.blights",
      icon: Bug,
      group: "work",
      order: 50,
      option: "track",
      available: (ctx) => ctx.collectsBlights || (ctx.blightCount ?? 0) > 0,
      badge: (ctx) => ctx.blightCount || undefined,
    },
  ],
  support: [
    {
      // Arrived rather than chosen. Feedback leads because a human wrote it;
      // a blight is filed by a machine.
      route: "projectFeedback",
      permission: "feedback:read",
      labelKey: "project.menu.feedback",
      icon: Inbox,
      group: "work",
      order: 40,
      badge: (ctx) => ctx.feedbackCount || undefined,
    },
  ],
};

/**
 * The entries no capability owns.
 *
 * Activity is the project's landing page and says something whatever else is
 * turned off. Reports is Core because its TABS declare capabilities - Quality
 * is Apps baseline and Members comes from a core table, so an Apps-only
 * project would lose its Quality tab along with the Reports entry.
 */
export const CORE_NAV: CapabilityNavEntry[] = [
  {
    route: "projectActivity",
    labelKey: "project.menu.activity",
    icon: Activity,
    group: "activity",
    order: 10,
  },
  /*
   * ⚠️ **No Notifications entry, and it is not an omission** (feedback
   * #P2127). The header bell is the only door to `/inbox`: two controls for
   * one page, both badged with the same count, one of them three centimetres
   * from the other.
   *
   * What that entry's own note argued still holds for the page and the bell,
   * so it is kept here rather than deleted with the row. The inbox is
   * **Core, not a capability**: a mention comes from a quest comment
   * (`work`) or a feedback comment (`support`), and a release publish from
   * `work`. Hang it off `work` and a Support-only project generates messages
   * with no door to them; hang it off `support` and the common case loses
   * it.
   *
   * ⚠️ **The URL stays `/inbox`.** The entry was labelled "Notifications"
   * only because the `Inbox` icon already belongs to the Feedback entry, and
   * removing the row settles that clash - but a segment is not a label, and
   * `projectInbox` and its path do not move.
   */
  {
    route: "projectReports",
    permission: "stats:read",
    labelKey: "project.menu.reports",
    icon: BarChart3,
    group: "record",
    order: 30,
    activeOn: (name) => name === "projectReports" || name.startsWith("reports"),
  },
];
