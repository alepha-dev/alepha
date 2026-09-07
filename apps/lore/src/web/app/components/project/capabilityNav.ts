import {
  Activity,
  AppWindow,
  Bell,
  BarChart3,
  BookOpen,
  Bug,
  Columns3,
  Flag,
  Grid3x2,
  Inbox,
  Layers,
  Package,
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
  questCount?: number;
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
  inboxCount?: number;
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
      // A destination, so it gets an entry of its own. It had one until the
      // 2026-08 rename took it, which is why `ProjectQuestsViewSwitcher` had
      // to be invented - the board was unreachable from the UI at all.
      route: "projectKanban",
      labelKey: "project.menu.kanban",
      icon: Columns3,
      group: "work",
      order: 20,
      option: "board",
    },
    {
      // A lens on quests, so it sits right after them: scope, then the items.
      route: "projectEpics",
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
  {
    /**
     * ⚠️ **Core, not a capability.** A mention comes from a quest comment
     * (`work`) or a feedback comment (`support`), and a release publish
     * comes from `work`. Hang this off `work` and a Support-only project
     * generates messages with no door to them; hang it off `support` and
     * the common case loses it. Reports is Core for the same shape of
     * reason: its tabs declare capabilities the entry itself cannot.
     *
     * ⚠️ Labelled "Notifications" with a `Bell`, matching the header
     * control, because the `Inbox` icon is already the Feedback entry's.
     * Two badged entries about unread things, one called Inbox and the
     * other wearing its icon, is a rail nobody can read. The URL stays
     * `/inbox`: a segment is not a label.
     */
    route: "projectInbox",
    labelKey: "project.menu.inbox",
    icon: Bell,
    group: "activity",
    order: 20,
    badge: (ctx) => ctx.inboxCount || undefined,
  },
  {
    route: "projectReports",
    labelKey: "project.menu.reports",
    icon: BarChart3,
    group: "record",
    order: 30,
    activeOn: (name) => name === "projectReports" || name.startsWith("reports"),
  },
];
