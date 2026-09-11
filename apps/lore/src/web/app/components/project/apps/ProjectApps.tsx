import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { FilterSlot } from "@alepha/ui/components/filter-slot/filter-slot";
import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Boxes,
  ExternalLink,
  Layers,
  Plus,
  Radio,
  Search,
  Tag,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { useRank } from "@/web/app/components/shared/useRank.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import AppCreateDialog from "./AppCreateDialog.tsx";
import { appLiveness } from "./appLiveness.ts";
import AppStatusDot from "./AppStatusDot.tsx";
import { appUrl, appUrlLabel } from "./appUrl.ts";

const filtersSchema = z.object({
  /**
   * ⚠️ Matches the Name and the Env columns BOTH, which is what makes a
   * tenant-ish substring like `b14` find anything at all: the app is called
   * `club` and only the env half carries the tenant.
   *
   * Local state rather than URL-backed. The breadcrumb link that would have
   * wanted `?search=` was decided against in #1768, so nothing reads it from
   * the URL and putting it there would be a parameter with one writer and no
   * reader.
   */
  search: z.string().optional(),
  /**
   * Single selects, one value or none - the reporter asked for "(mono)" and
   * the two questions they answer are singular: which envs does `api` have,
   * which apps are in `production`.
   *
   * ⚠️ No sentinel item, per the convention settled in #Q1816: the EMPTY
   * selection is the unfiltered state, which is what `clearable` gives back.
   * An "All apps" row would be a value the schema has to carry and every
   * predicate has to special-case.
   *
   * `app` and `env` are plain strings and not enums on purpose. An env is an
   * opaque free slug, so the option list is derived from the rows the page
   * already holds; a union here would be a closed set over an open one.
   */
  app: z.string().optional(),
  env: z.string().optional(),
  status: z.enum(["reporting", "silent", "none"]).optional(),
  /**
   * The deployed tag, as a select over the values actually present.
   *
   * ⚠️ `latest` is in that list like any other value, and the label must not
   * imply that everything on it is one build: `artifacts.tag` allows `latest`
   * and its bytes may change, so two copies both reading `latest` may be
   * running different code. Same shape as `app` and `env` above: a single
   * select with no sentinel row, over the rows already on screen.
   */
  version: z.string().optional(),
});

/**
 * Every deployed copy of every app, in one flat table.
 *
 * **The sidebar's Apps entry points here, and that is the only door.** It used
 * to be a disclosure group with one child per app, which is why this page was
 * once described as deliberately absent from the nav; #1771 collapsed the group
 * to a single entry, because a list that grows without bound does not belong in
 * the chrome. The list is the search surface now, and the entry is its door.
 *
 * ## Flat, and grouping was tried and rejected
 *
 * ⚠️ Instances were specified to sit under a collapsible app header until
 * 2026-09-04, with a single-instance app rendering as a plain row so the level
 * stayed invisible. Reviewed against the mockup and dropped. One row per
 * instance, every row the same shape.
 *
 * The app name repeats down the Name column, and the repeats are deliberately
 * NOT blank-filled: a blank cell breaks sorting on every other column, and
 * sorting is most of what a flat list is for.
 *
 * ## Three columns, and what left with them
 *
 * `Reports` (the `kinds` badges), `Last seen`, `Token` and `Enrolled` are cut:
 * the first is noise on a list and the rest belong on the instance page.
 * Liveness survives as a status dot before the name, which costs no column
 * width.
 *
 * ## The Version column, and where it comes from
 *
 * `instance.version` is the tag of that copy's newest SUCCEEDED deployment,
 * filled by `AppController.toResources` from the `deployments` table in the
 * same batched read as the sigil and the estate. v3 shipped three columns
 * because nothing knew the answer; epic #1's table is what made it knowable.
 *
 * ⚠️ **Never the newest artifact tag.** That is per app rather than per copy,
 * says what was BUILT rather than what runs, and is wrong on the first
 * promotion - which is the whole reason the slot stayed empty rather than being
 * filled with something plausible.
 *
 * ⚠️ A copy that has never deployed shows nothing, not a dash: there is no
 * version, rather than an unknown one.
 *
 * ## Static-data mode, so there is no second request
 *
 * `currentInstancesAtom` is already filled by the project route's own loader,
 * and `AlephaTable` filters, sorts and pages an array it is handed in memory.
 * ⚠️ `refresh()` does not re-fire anything in this mode; a page that creates or
 * deletes has to hand the table a new array, which is what `AppCreateDialog`
 * and the Settings tab's delete both do.
 */
const ProjectApps = () => {
  // `l` for the two date columns. ⚠️ `I18nLocalizeOptions` has `date` only,
  // so a date-and-time cell passes a dayjs format string rather than a
  // `time` option that does not exist.
  const { tr, l } = useI18n<I18n, "en">();
  const { can } = useRank();
  const router = useRouter<AppRouter>();
  const dateTime = useInject(DateTimeProvider);

  const [project] = useStore(currentProjectAtom);
  const [instances] = useStore(currentInstancesAtom);
  const [creating, setCreating] = useState(false);

  if (!project) {
    return null;
  }

  // Creating an instance is owner-only server-side, so the action is hidden
  // rather than shown and refused. A member reads the list and does not add to
  // it.
  const isOwner = can("app:manage");
  const now = dateTime.nowMillis();

  /**
   * The App and Env option lists, derived from the rows on screen.
   *
   * Alphabetical, and `localeCompare` rather than `<` so an accented or
   * uppercase name lands where a reader expects it rather than by code point.
   * Both are unbounded sets - an app name exists because a row carries it,
   * and an env is a free slug - so there is no enum to read them from and
   * there must not be one.
   */
  const optionsOf = (key: "app" | "env") =>
    [...new Set((instances ?? []).map((instance) => instance[key]))]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));

  // ⚠️ Plain calls, never `useMemo`: this sits below `if (!project) return
  // null`, so a hook here would be a conditional one. The lists are a Set
  // over the rows already on screen, which is cheaper than the render that
  // follows it.
  const appOptions = optionsOf("app");
  const envOptions = optionsOf("env");

  // ⚠️ Not `optionsOf`: a copy that has never deployed has no version at all,
  // so this list is the values PRESENT rather than one per row. Sorted as
  // text and never as a semver - `latest` is in it and has no place in a
  // version order, and the column it filters does not sort that way either.
  const versionOptions = [
    ...new Set(
      (instances ?? []).flatMap((it) => (it.version ? [it.version] : [])),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));

  const openInstance = (instance: AppInstanceResource) =>
    void router.push("app", {
      params: {
        projectSlug: project.slug,
        app: instance.app,
        env: instance.env,
      },
    });

  const hrefOf = (instance: AppInstanceResource) =>
    router.path("app", {
      params: {
        projectSlug: project.slug,
        app: instance.app,
        env: instance.env,
      },
    });

  /**
   * ⚠️ `undefined` is "the read failed", `[]` is "this project has no apps",
   * and they must not collapse into one falsy check: an empty state on a
   * transient failure claims a project has no apps. This page owns the
   * failed-read state now that the sidebar's "Couldn't load apps" entry is
   * gone (#1771).
   */
  if (instances === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <TriangleAlert className="text-muted-foreground size-5" />
        <span className="text-sm font-medium">{tr("apps.unavailable")}</span>
        <span className="text-muted-foreground text-xs">
          {tr("apps.unavailable.description")}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="apps-table"
      // `p-2` and nothing more, matching Epics, Releases and Blights (the
      // frame every project and admin page shares since #Q2266). The
      // extra `md:pt-10` existed to give the page heading room above the
      // table; the heading is gone (feedback #2081 - the breadcrumb already
      // says "Apps" two lines up, and no other project list carries one), so
      // the inset went with it and this page starts where its siblings do.
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-2"
    >
      <AlephaTable<AppInstanceResource>
        className="min-h-0 flex-1"
        data={instances}
        persistenceKey={`lor.apps.${project.id}`}
        // ⚠️ **Filters deliberately excluded**, which is the whole reason this
        // page has a `persistenceKey` at all. The hidden columns below are
        // worth remembering; the search is not. Restoring it opened the list
        // narrowed by whatever the reader last typed - the hazard
        // `seedValues`'s own note names, "landing on last week's stored
        // filter" - and `apps.spec` caught it by arriving here after an
        // earlier step had searched.
        //
        // Keyed per project: `env` values are project-specific, so one
        // project's stored column layout has no business on another's list.
        persist={{ filters: false }}
        // Not "no apps enrolled": enrolment is no longer how an app comes into
        // existence, and the empty state's job here is to offer the create.
        //
        // ⚠️ Two states, never the single `empty` node this used to be. That
        // prop replaces BOTH of them at once, so a filter that matched nothing
        // still offered to create the first app, with the filter that produced
        // it sitting in the toolbar above (feedback #P2160). The choice
        // belongs to the table, which reads it off `activeFilterCount` - and
        // that counter is live here despite static-data mode, because the
        // `refreshKey` the filter form bumps is the same one that recomputes
        // the local page.
        emptyState={{
          icon: Boxes,
          title: tr("apps.empty"),
          description: tr("apps.empty.description"),
          action: isOwner ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {tr("apps.create.title")}
            </Button>
          ) : undefined,
        }}
        // No action on this side. Clearing the filters is already one button
        // away in the toolbar, and `resetFilters` lives inside the table with
        // nothing handing it out, so a second copy here would be a new API
        // rather than a slot fill.
        noMatchState={{
          title: tr("apps.noMatch"),
          description: tr("apps.noMatch.description"),
        }}
        // The same dialog the header's create menu opens, mounted here as the
        // page's primary action: this list is where somebody who came looking
        // for their apps already is.
        actions={
          isOwner
            ? [
                {
                  icon: Plus,
                  label: String(tr("apps.create.title")),
                  primary: true,
                  onClick: () => setCreating(true),
                },
              ]
            : []
        }
        // App then env, which is how the pair reads. The env half is the
        // table's own secondary order: sorting a stable list by one column
        // leaves the previous order underneath it, and the data arrives from
        // `listApps` already ordered by the pair.
        defaultSort={{ field: "app", direction: "asc" }}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <>
              <FilterSlot>
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("apps.filter.search")}
                  inputProps={{ "aria-label": tr("apps.filter.search") }}
                />
              </FilterSlot>
              {/* Both lists are hidden below two values, the way the Epics
                  table hides its Release filter with no release: a select
                  whose only option matches every row is a control with
                  nothing to do. */}
              {appOptions.length > 1 && (
                <FilterSlot>
                  <Control
                    select
                    clearable
                    input={form.input.app}
                    label=""
                    icon={Boxes}
                    triggerClassName="w-full"
                    // Doubles as the empty trigger's placeholder, which is
                    // the whole of the way #Q1816 settled: there is no clear
                    // ROW in the list, so the label says what unfiltered
                    // means and the trigger's `x` is how you get back to it.
                    clearLabel={String(tr("apps.filter.app"))}
                    items={appOptions}
                    inputProps={{ "aria-label": tr("apps.filter.app") }}
                  />
                </FilterSlot>
              )}
              {envOptions.length > 1 && (
                <FilterSlot>
                  <Control
                    select
                    clearable
                    input={form.input.env}
                    label=""
                    icon={Layers}
                    triggerClassName="w-full"
                    // Doubles as the empty trigger's placeholder, which is
                    // the whole of the way #Q1816 settled: there is no clear
                    // ROW in the list, so the label says what unfiltered
                    // means and the trigger's `x` is how you get back to it.
                    clearLabel={String(tr("apps.filter.env"))}
                    items={envOptions}
                    inputProps={{ "aria-label": tr("apps.filter.env") }}
                  />
                </FilterSlot>
              )}
              <FilterSlot>
                <Control
                  select
                  clearable
                  input={form.input.status}
                  label=""
                  icon={Radio}
                  triggerClassName="w-full"
                  // Doubles as the empty trigger's placeholder, which is
                  // the whole of the way #Q1816 settled: there is no clear
                  // ROW in the list, so the label says what unfiltered
                  // means and the trigger's `x` is how you get back to it.
                  clearLabel={String(tr("apps.filter.status"))}
                  // Semantic order, not alphabetical: reporting, silent,
                  // never wired up.
                  //
                  // ⚠️ These used to be `AppStatusDot`'s own strings, on the
                  // reasoning that the dot and the filter must not disagree
                  // about what a state is called. They now diverge on
                  // purpose, because the two are not saying the same kind of
                  // thing: a dropdown is a list of NAMES, and "Silent for
                  // over a day" and "No sigil, nothing reports" are
                  // explanations of a state rather than names for one.
                  //
                  // The dot keeps the long form and needs it - it is a
                  // coloured circle with no other context, so its accessible
                  // name is the only place the threshold and the reason can
                  // be stated. `apps.status.*` therefore keeps its existing
                  // meaning and the short names are new keys beside it, so
                  // nothing changes meaning under a name already in use.
                  //
                  // `reporting` is shared: it was already a name.
                  items={[
                    {
                      value: "reporting",
                      label: tr("apps.status.reporting"),
                    },
                    { value: "silent", label: tr("apps.status.silent.short") },
                    { value: "none", label: tr("apps.status.none.short") },
                  ]}
                  inputProps={{ "aria-label": tr("apps.filter.status") }}
                />
              </FilterSlot>
              {/* ⚠️ Hidden when NOTHING has a version, not below two values
                  like App and Env: one deployed copy among ten is exactly the
                  case somebody wants to isolate, and a select with a single
                  option is still doing work here. */}
              {versionOptions.length > 0 && (
                <FilterSlot>
                  <Control
                    select
                    clearable
                    input={form.input.version}
                    label=""
                    icon={Tag}
                    triggerClassName="w-full"
                    clearLabel={String(tr("apps.filter.version"))}
                    items={versionOptions}
                    inputProps={{ "aria-label": tr("apps.filter.version") }}
                  />
                </FilterSlot>
              )}
            </>
          ),
        }}
        // ⚠️ A caller-supplied `filter` REPLACES the built-in field matching
        // entirely (`paginateLocal`), so every filter is answered here - `app`
        // and `env` included, even though they are named after properties.
        // Leaving them to the built-in pass would not work twice over: it
        // never runs once this prop is set, and it matches a string as a
        // case-insensitive SUBSTRING, so picking `club` would also keep
        // `clubhouse`. A single select means equality.
        //
        // `status` could not use it either way: it is derived by
        // `appLiveness`, not carried on the row.
        //
        // Only values that are actually set reach this, so each clause is a
        // guard rather than a default.
        filter={(instance, values) => {
          const version = String(values.version ?? "");
          if (version && instance.version !== version) {
            return false;
          }
          const search = String(values.search ?? "").toLowerCase();
          if (search) {
            const url = appUrl(instance) ?? "";
            const hit =
              instance.app.toLowerCase().includes(search) ||
              instance.env.toLowerCase().includes(search) ||
              url.toLowerCase().includes(search);
            if (!hit) return false;
          }
          if (values.app && instance.app !== values.app) return false;
          if (values.env && instance.env !== values.env) return false;
          if (values.status && appLiveness(instance, now) !== values.status) {
            return false;
          }
          return true;
        }}
        onRowClick={openInstance}
        columns={{
          // ⚠️ No width class here, and that is a decision rather than an
          // omission. It carried `w-full max-w-0 min-w-40`, the idiom the
          // other Lore tables still use: `w-full` makes one column absorb
          // every spare pixel and `max-w-0` makes `truncate` inside it follow
          // the width instead of the content. The cost is what the owner saw
          // on 2026-09-06 - Env and Address shrink-wrapped against the right
          // edge of a wide screen, with the whole table reading as one column
          // and two labels.
          //
          // Dropped because this table's values are SHORT: an app name, an
          // env, a host. Nothing here needs the width, so the columns are left
          // to the browser's auto layout, which spreads the spare space across
          // all three.
          //
          // `truncate` stays on the cells below and is now inert: a table cell
          // with no `max-w-0` sizes to its content, so a very long app name
          // widens the column rather than ellipsing. Kept as the guard it will
          // be again if this column is ever given a width back.
          app: {
            label: tr("apps.table.name"),
            sortable: true,
            cell: (instance) => (
              <span className="flex min-w-0 items-center gap-2">
                <AppStatusDot state={appLiveness(instance, now)} />
                <Link
                  href={hrefOf(instance)}
                  className="block truncate font-medium"
                >
                  {instance.app}
                </Link>
              </span>
            ),
          },
          env: {
            label: tr("apps.table.env"),
            sortable: true,
            cell: (instance) => (
              <span className="truncate text-sm">{instance.env}</span>
            ),
          },
          version: {
            label: tr("apps.table.version"),
            sortable: true,
            cell: (instance) =>
              instance.version ? (
                <span
                  className={
                    // ⚠️ `latest` is a pointer, not a version. Muted so it does
                    // not read as a release, and never sorted as a semver -
                    // the column sorts as text, which is what it is.
                    instance.version === "latest"
                      ? "text-muted-foreground truncate font-mono text-xs"
                      : "truncate font-mono text-xs"
                  }
                >
                  {instance.version}
                </span>
              ) : (
                // Nothing, not a dash: this copy has no version, rather than
                // one nobody could read.
                <span />
              ),
          },
          url: {
            label: tr("apps.table.address"),
            sortable: true,
            cell: (instance) => {
              // An instance with no sigil never posts to the ingest, so it has
              // no detected host at all, and neither does a Feedback-only app.
              // That reads as unknown rather than as a broken link.
              const url = appUrl(instance);
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  // ⚠️ Not decoration, and the same three the app header
                  // carries. The address is operator-supplied or detected
                  // from a reporting app's own `Host` header, so it is a
                  // THIRD-PARTY destination reached from inside Lore's
                  // session: `noopener` because `_blank` otherwise hands
                  // `window.opener` to a page Lore does not control, and
                  // `nofollow` because a deployed copy is not an endorsement
                  // Lore is making.
                  rel="noopener noreferrer nofollow"
                  // ⚠️ The row IS a link to the instance page. Without this
                  // one click both opens the app in a new tab and navigates
                  // the page underneath it, so the reader comes back to
                  // somewhere they did not ask for.
                  onClick={(event) => event.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 text-xs transition-colors"
                >
                  {/* ⚠️ The TRUNCATION is on the label, not on the anchor.
                      An anchor that truncates as a whole eats its trailing
                      icon first, which is the one part that cannot be
                      guessed from what survives: a clipped host still reads
                      as a host, a missing icon reads as plain text. The
                      icon is `shrink-0` for the same reason. */}
                  <span className="truncate">{appUrlLabel(url)}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              ) : // ⚠️ Nothing at all, and never a link with no href. A copy
              // with no sigil never posts to the ingest and neither does a
              // Feedback-only app, so this is a real state rather than a
              // missing value: an anchor that goes nowhere says the
              // opposite, and so did the words that used to be here.
              //
              // "Not known yet" was the string, and `yet` was doing the
              // damage - between two real hostnames it read as a value
              // still loading, or one the system would fill in later.
              // Neither is true. An empty cell in a column of links is
              // unambiguous, which is why this site can say nothing while
              // `AppDashboardIdentity` still needs a word: there, the
              // address is one row of a label/value grid, and a blank value
              // beside a label reads as a broken render rather than an
              // absent one.
              null;
            },
          },
          /*
           * ⚠️ The three below start HIDDEN, and the split is by what this
           * list is FOR: it answers "what do we run and where", so identity
           * and liveness are on and provenance is a click away.
           *
           * ⚠️ No Status column, deliberately. Liveness is already the dot in
           * the App column, and a second rendering of one fact is what the
           * shelved-quest badge was. What IS worth a column is the value
           * BEHIND the dot - when it last reported, rather than whether -
           * which is `lastSeenAt` below.
           */
          lastSeenAt: {
            label: tr("apps.table.lastSeen"),
            sortable: true,
            defaultHidden: true,
            // The value lives under `sigil`, so the sort cannot come from the
            // column key. An instance with no sigil has none at all and sorts
            // last, which `paginateLocal` does with a nullish value whichever
            // way the arrow points.
            sortValue: (instance) => instance.sigil?.lastSeenAt,
            // ⚠️ Relative, with the exact datetime on hover. It rendered
            // `lll` outright until feedback #P2174, which is four rows of
            // "Sep 9, 2026 7:00 PM" and a reader subtracting dates by hand to
            // answer the one question this column exists for: is this copy
            // alive. The Blights table one page over had it right already.
            cell: (instance) =>
              instance.sigil?.lastSeenAt ? (
                <TimeAgo
                  value={instance.sigil.lastSeenAt}
                  className="text-muted-foreground text-xs whitespace-nowrap"
                />
              ) : (
                // Nothing, not a dash: a copy with no sigil never reports, so
                // there is no last time rather than an unknown one.
                <span />
              ),
          },
          estate: {
            label: tr("apps.table.estate"),
            sortable: true,
            defaultHidden: true,
            sortValue: (instance) => instance.estate?.slug,
            cell: (instance) => (
              <span className="text-muted-foreground truncate text-xs">
                {instance.estate?.slug ?? ""}
              </span>
            ),
          },
          createdAt: {
            label: tr("apps.table.created"),
            sortable: true,
            defaultHidden: true,
            cell: (instance) => (
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {String(l(instance.createdAt, { date: "lll" }))}
              </span>
            ),
          },
        }}
      />

      <AppCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={openInstance as never}
      />
    </div>
  );
};

export default ProjectApps;
