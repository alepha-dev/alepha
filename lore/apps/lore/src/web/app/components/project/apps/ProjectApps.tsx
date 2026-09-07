import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Boxes,
  Layers,
  Plus,
  Radio,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { useRank } from "@/web/app/components/shared/useRank.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";
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
 * ⚠️ **No Version column in v3.** The spec's fourth column is "the deployed
 * tag" and nothing in Lore knows it: there is no `deployments` table until epic
 * #1, the reporting envelope carries no app version, and an estate command's
 * payload holds a sha256 and no tag. It lands with #1203. **Do not fill the
 * slot with the newest artifact tag** - that is per app rather than per
 * instance, says what was built rather than what runs, and would be wrong on
 * the first promotion.
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
  const { tr } = useI18n<I18n, "en">();
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
      // `p-4` and nothing more, matching Epics, Releases and Blights. The
      // extra `md:pt-10` existed to give the page heading room above the
      // table; the heading is gone (feedback #2081 - the breadcrumb already
      // says "Apps" two lines up, and no other project list carries one), so
      // the inset went with it and this page starts where its siblings do.
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-4"
    >
      <AlephaTable<AppInstanceResource>
        className="min-h-0 flex-1"
        data={instances}
        // Not "no apps enrolled": enrolment is no longer how an app comes into
        // existence, and the empty state's job here is to offer the create.
        empty={
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="text-sm font-medium">{tr("apps.empty")}</span>
            <span className="text-muted-foreground max-w-sm text-xs">
              {tr("apps.empty.description")}
            </span>
            {isOwner && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {tr("apps.create.title")}
              </Button>
            )}
          </div>
        }
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
                  // never wired up. The labels are `AppStatusDot`'s own, so
                  // the dot and the filter cannot come to disagree about what
                  // a state is called.
                  items={[
                    {
                      value: "reporting",
                      label: tr("apps.status.reporting"),
                    },
                    { value: "silent", label: tr("apps.status.silent") },
                    { value: "none", label: tr("apps.status.none") },
                  ]}
                  inputProps={{ "aria-label": tr("apps.filter.status") }}
                />
              </FilterSlot>
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
          url: {
            label: tr("apps.table.address"),
            sortable: true,
            cell: (instance) => {
              // An instance with no sigil never posts to the ingest, so it has
              // no detected host at all, and neither does a Feedback-only app.
              // That reads as unknown rather than as a broken link.
              const url = appUrl(instance);
              return url ? (
                <span className="text-muted-foreground truncate text-xs">
                  {appUrlLabel(url)}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("app.dashboard.address.unknown")}
                </span>
              );
            },
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
