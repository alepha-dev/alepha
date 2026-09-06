import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Plus, Search, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
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
  const router = useRouter<AppRouter>();
  const dateTime = useInject(DateTimeProvider);

  const [project] = useStore(currentProjectAtom);
  const [instances] = useStore(currentInstancesAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [creating, setCreating] = useState(false);

  if (!project) {
    return null;
  }

  // Creating an instance is owner-only server-side, so the action is hidden
  // rather than shown and refused. A member reads the list and does not add to
  // it.
  const isOwner = member?.owner ?? false;
  const now = dateTime.nowMillis();

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
            <FilterSlot>
              <Control
                input={form.input.search}
                label=""
                icon={Search}
                placeholder={tr("apps.filter.search")}
                inputProps={{ "aria-label": tr("apps.filter.search") }}
              />
            </FilterSlot>
          ),
        }}
        // The built-in field matching pairs a filter with the same-named
        // property, and this one is not: `search` spans three values.
        filter={(instance, values) => {
          const search = String(values.search ?? "").toLowerCase();
          if (!search) return true;
          const url = appUrl(instance) ?? "";
          return (
            instance.app.toLowerCase().includes(search) ||
            instance.env.toLowerCase().includes(search) ||
            url.toLowerCase().includes(search)
          );
        }}
        onRowClick={openInstance}
        columns={{
          app: {
            label: tr("apps.table.name"),
            sortable: true,
            className: "w-full max-w-0 min-w-40",
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
