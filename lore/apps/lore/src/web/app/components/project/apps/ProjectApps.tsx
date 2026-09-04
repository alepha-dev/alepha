import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Search, SignalHigh } from "lucide-react";

import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilsAtom } from "../../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import FilterSlot from "../../shared/FilterSlot.tsx";
import { appUrl, appUrlLabel } from "./appUrl.ts";

/**
 * How long an app may say nothing before it counts as silent.
 *
 * The same day `AppDashboardIdentity` uses, and for the same reason: an app
 * with real but thin traffic can go hours between batches, and a badge that
 * lights up overnight teaches its owner to ignore it.
 */
const SILENT_AFTER_MS = 24 * 60 * 60 * 1000;

const filtersSchema = z.object({
  search: z.string().optional(),
  reporting: z.enum(["reporting", "silent"]).optional(),
});

/**
 * Every enrolled app in one table.
 *
 * Deliberately basic: this is the field being prepared, not the finished
 * surface. What lives under an app is going to move once deployments land.
 *
 * **Not in the sidebar.** The sidebar already carries an Apps disclosure group
 * with one child per app, and a list entry beside it would be a second door to
 * the same information. The way in is the breadcrumb: `projectApps` is in
 * `SECTION_HREF_ROUTES` now, so the "Apps" segment that used to render as dead
 * text on every app page is a link, with no new chrome anywhere.
 *
 * **Static-data mode, so there is no second request.** `currentSigilsAtom` is
 * already filled by the project route's own loader, and `AlephaTable` filters,
 * sorts and pages an array it is handed in memory. ⚠️ `refresh()` does not
 * re-fire anything in this mode; a page that enrols or deletes has to hand the
 * table a new array.
 */
const ProjectApps = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dateTime = useInject(DateTimeProvider);

  const [project] = useStore(currentProjectAtom);
  const [sigils] = useStore(currentSigilsAtom);

  if (!project) {
    return null;
  }

  const isSilent = (sigil: SigilResource) =>
    !sigil.lastSeenAt ||
    dateTime.nowMillis() - new Date(sigil.lastSeenAt).getTime() >
      SILENT_AFTER_MS;

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
      <AlephaTable<SigilResource>
        className="min-h-0 flex-1"
        // `undefined` is "the read failed", `[]` is "none enrolled". Only the
        // second is an empty state; the first is handled by the sidebar's own
        // "Couldn't load apps" entry, and an empty table here would claim a
        // project has no apps on the strength of a transient failure.
        data={sigils ?? []}
        emptyMessage={tr("sigils.empty")}
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
              <FilterSlot>
                <Control
                  input={form.input.reporting}
                  label=""
                  clearable
                  icon={SignalHigh}
                  clearLabel={tr("apps.filter.allApps")}
                  triggerClassName="w-full"
                  items={[
                    {
                      label: String(tr("apps.filter.reporting")),
                      value: "reporting",
                    },
                    {
                      label: String(tr("apps.filter.silent")),
                      value: "silent",
                    },
                  ]}
                  inputProps={{ "aria-label": tr("apps.filter.reporting") }}
                />
              </FilterSlot>
            </>
          ),
        }}
        // The built-in field matching pairs a filter with the same-named
        // property, and neither of these is one: `search` spans the name and
        // the address, and `reporting` is a question about a timestamp.
        filter={(sigil, values) => {
          const search = String(values.search ?? "").toLowerCase();
          if (search) {
            const url = appUrl(sigil) ?? "";
            if (
              !sigil.name.toLowerCase().includes(search) &&
              !url.toLowerCase().includes(search)
            ) {
              return false;
            }
          }
          if (values.reporting === "silent" && !isSilent(sigil)) return false;
          if (values.reporting === "reporting" && isSilent(sigil)) return false;
          return true;
        }}
        onRowClick={(sigil) =>
          void router.push("app", {
            params: { projectSlug: project.slug, appName: sigil.name },
          })
        }
        columns={{
          name: {
            label: tr("apps.table.name"),
            sortable: true,
            className: "w-full max-w-0 min-w-40",
            cell: (sigil) => (
              <Link
                href={router.path("app", {
                  params: { projectSlug: project.slug, appName: sigil.name },
                })}
                className="block truncate font-medium"
              >
                {sigil.name}
              </Link>
            ),
          },
          url: {
            label: tr("apps.table.address"),
            cell: (sigil) => {
              // A Feedback-only app never posts to the ingest, so it has no
              // detected host at all. That reads as unknown rather than as a
              // broken link.
              const url = appUrl(sigil);
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
          kinds: {
            label: tr("apps.table.reports"),
            cell: (sigil) =>
              sigil.kinds.length === 0 ? (
                <span className="text-muted-foreground text-xs">-</span>
              ) : (
                // ⚠️ `flex-nowrap`, not the `flex-wrap` this had. An app
                // carrying all four kinds wrapped its badges into a column and
                // made its row four times the height of its neighbours
                // (feedback #2081, at 1920x929). A table row is a line; a cell
                // that stacks is one that has not been given its width.
                //
                // The column takes the width instead, which the table has:
                // `<td>` sizes to content, and the page had 1000px of empty
                // space to the right of the last column at the width this was
                // reported from.
                <span className="flex flex-nowrap items-center gap-1">
                  {sigil.kinds.map((kind) => (
                    <Badge
                      key={kind}
                      variant="outline"
                      className="text-xs whitespace-nowrap"
                    >
                      {kind}
                    </Badge>
                  ))}
                </span>
              ),
          },
          lastSeenAt: {
            label: tr("apps.table.lastSeen"),
            sortable: true,
            cell: (sigil) => (
              <span className="flex flex-wrap items-center gap-2 text-xs whitespace-nowrap">
                {sigil.lastSeenAt ? (
                  String(l(sigil.lastSeenAt, { date: "ll" }))
                ) : (
                  <span className="text-muted-foreground">
                    {tr("sigils.neverSeen")}
                  </span>
                )}
                {isSilent(sigil) && sigil.lastSeenAt && (
                  <Badge variant="outline" className="text-amber-600">
                    {tr("app.dashboard.silent")}
                  </Badge>
                )}
              </span>
            ),
          },
          tokenPrefix: {
            label: tr("apps.table.token"),
            cell: (sigil) => (
              <code className="font-mono text-xs">{sigil.tokenPrefix}…</code>
            ),
          },
          createdAt: {
            label: tr("app.dashboard.enrolled"),
            sortable: true,
            cell: (sigil) => (
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {String(l(sigil.createdAt, { date: "ll" }))}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};

export default ProjectApps;
