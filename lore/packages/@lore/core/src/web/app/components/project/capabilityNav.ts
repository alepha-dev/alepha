import type { Atom, Infer, TAtomObject } from "alepha";
import { Activity, BarChart3, Gauge } from "lucide-react";

/**
 * What a registered badge, predicate or breadcrumb reads besides its own
 * declaration (#E75, #Q2624).
 */
export interface ProjectShellContext {
  /**
   * `$page` name of the route currently open.
   */
  routeName: string;
  params: Record<string, string | undefined>;
  /**
   * The current value of a module's atom. A read, not a subscription: the
   * entry declares the atom in `reads`, and the shell subscribes.
   */
  get: <T extends TAtomObject>(atom: Atom<T>) => Infer<T> | undefined;
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
  badge?: (context: ProjectShellContext) => number | undefined;
  /**
   * A last say beyond the capability and the option, for an entry that hides
   * itself on DATA. Only Blights has one.
   */
  available?: (context: ProjectShellContext) => boolean;
  /**
   * The atoms `badge` and `available` read, so the shell re-renders when one
   * of them changes.
   */
  reads?: Atom<any>[];

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
 * The entries no capability owns.
 *
 * The dashboard is the project's landing page and Activity sits under it;
 * both say something whatever else is turned off, which is what makes them
 * Core. Reports is Core because its TABS declare capabilities - Quality
 * is Apps baseline and Members comes from a core table, so an Apps-only
 * project would lose its Quality tab along with the Reports entry.
 */
export const CORE_NAV: CapabilityNavEntry[] = [
  {
    // The project's landing page, and therefore first. ⚠️ No `permission`,
    // like Activity below it: `project:read` is the floor every rank holds,
    // so gating either would be a check that can never fail.
    route: "projectDashboard",
    labelKey: "project.menu.dashboard",
    icon: Gauge,
    group: "activity",
    order: 10,
  },
  {
    route: "projectActivity",
    labelKey: "project.menu.activity",
    icon: Activity,
    group: "activity",
    order: 20,
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
