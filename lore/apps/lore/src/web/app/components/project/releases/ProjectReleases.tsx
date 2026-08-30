import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { type Page, z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { CircleDot, Flag, Plus, Search } from "lucide-react";
import { useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseCreateDialog from "./ReleaseCreateDialog.tsx";
import ReleaseProgress from "./ReleaseProgress.tsx";
import {
  releaseState,
  STATE_ICONS,
  STATE_LABEL_KEYS,
  STATE_TONE,
} from "./releaseState.ts";

const releasesFiltersSchema = z.object({
  search: z.string().optional(),
  state: z.enum(["open", "released"]).optional(),
});

/**
 * Every release in the project, built on {@link AlephaTable}.
 *
 * It was a hand-rolled card list with an OPEN heading, a RELEASED heading and
 * an inline create form, while Epics next door had search, filters, sortable
 * headers and a row menu. Two lists of the same project's work, read two
 * different ways.
 *
 * Modelled on `ProjectEpics.tsx`, which documents four rules worth repeating
 * and this page now repeats:
 *
 * - the identifier is part of the name rather than a column of its own. For a
 *   release the identifier is the TAG, so `0.28.0` plays the part `#12 -
 *   Title` plays on an epic;
 * - the whole row is clickable and the title is a real anchor inside it, so a
 *   plain click routes while cmd or middle click opens a tab;
 * - the coloured state is the first thing on the row;
 * - the chip is `tint` + tone + glyph, not a solid fill.
 *
 * `getReleases` returns the project's whole list in one response, so search,
 * filter, sort and paging are all client-side here. Same shape as
 * `ProjectEpics` and `ProjectBlights`.
 *
 * ## Open and released became a FILTER, not two sections
 *
 * The two headings could not survive the move: a table is one flat list, and
 * faking sections inside it would give up the sorting that is the reason to
 * be here. The state became a derived two-value filter instead, and
 * `releaseState.ts` carries why it is derived rather than stored.
 *
 * **The property the headings encoded is preserved, not lost.** "There is no
 * active state because nothing pauses" is a deliberate fact about this model,
 * and the filter has exactly two values because of it. What is given up is
 * seeing both groups labelled at once; what is gained is sorting either of
 * them by target date or by progress.
 *
 * ⚠️ Ordered by `number`, **never by `tag`**. Semver does not sort as text:
 * `0.10.0` comes before `0.9.0`. Same bug class as the text-enum priority
 * ordering that put `optional` above `high` on the board for a year, and the
 * same rule #1633 applies on the Epics side. The tag column therefore sorts
 * on `number`, which is what the header says and what the comparator does.
 *
 * The default sort is `number` DESCENDING, which is the closest thing to the
 * old page's reading order: open releases are the recent ones, so they still
 * arrive at the top without the table having to know what "open" means.
 */
const ProjectReleases = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  // Write-only. The table fetches its own rows, but the atom is what the
  // sidebar and both release CONTROLS read, so a create has to refresh it.
  const [, setReleases] = useStore(currentReleasesAtom);
  const releaseApi = useClient<ReleaseController>();

  const [creating, setCreating] = useState(false);
  // Bumped after a create, which happens outside the table and so has no
  // `ctx.refresh()` of its own to call.
  const [reload, setReload] = useState(0);

  if (!project) return null;

  /**
   * The table refetches itself off `refreshSignal`, but the atom has to be
   * refreshed by hand: it is what the sidebar and both release CONTROLS
   * read, and none of them is watching this table.
   */
  const created = async () => {
    setReleases(
      await releaseApi.getReleases({ params: { projectId: project.id } }),
    );
    setReload((n) => n + 1);
  };

  const fetchReleases = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }): Promise<Page<ReleaseResource>> => {
    const all = await releaseApi.getReleases({
      params: { projectId: project.id },
    });

    const state = filters?.state as "open" | "released" | undefined;
    const needle = String(filters?.search ?? "")
      .trim()
      .toLowerCase();

    const rows = sortReleases(
      all.filter((release) => {
        if (state && releaseState(release) !== state) return false;
        if (!needle) return true;
        return (
          (release.tag ?? "").toLowerCase().includes(needle) ||
          release.title.toLowerCase().includes(needle)
        );
      }),
      sort,
    );

    const offset = page * size;
    const content = rows.slice(offset, offset + size);
    return {
      content,
      page: {
        number: page,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
        isEmpty: content.length === 0,
        isFirst: page === 0,
        isLast: offset + size >= rows.length,
      },
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <ReleaseCreateDialog
        projectId={project.id}
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => void created()}
      />

      <AlephaTable<ReleaseResource>
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey={`lor.releases.${project.id}`}
        defaultSort={{ field: "tag", direction: "desc" }}
        // The full empty state rather than `emptyMessage`, so the page that
        // has never had a release still explains what one IS and offers the
        // way to make one. A bare "No results" in a table nobody has filled
        // teaches nothing.
        empty={
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Flag className="text-muted-foreground size-7" />
            <h2 className="text-[15px] font-semibold">
              {tr("release.empty.title")}
            </h2>
            <p className="text-muted-foreground max-w-md text-[13px] text-pretty">
              {tr("release.empty.body")}
            </p>
            <Button className="mt-1" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {tr("release.start")}
            </Button>
          </div>
        }
        refreshSignal={reload}
        filters={{
          schema: releasesFiltersSchema,
          render: (form) => (
            <>
              <div className="w-56">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder={tr("release.filter.search")}
                  inputProps={{ "aria-label": tr("release.filter.search") }}
                />
              </div>
              <div className="w-44">
                <Control
                  input={form.input.state}
                  label=""
                  clearable
                  icon={CircleDot}
                  clearLabel={tr("release.filter.allStates")}
                  triggerClassName="w-full"
                  items={[
                    { label: tr("release.group.open"), value: "open" },
                    { label: tr("release.group.released"), value: "released" },
                  ]}
                  inputProps={{ "aria-label": tr("release.filter.state") }}
                />
              </div>
            </>
          ),
        }}
        fetch={fetchReleases}
        onRowClick={(release) =>
          release.tag &&
          router.push("projectRelease", {
            params: { releaseTag: release.tag },
          })
        }
        actions={[
          {
            icon: Plus,
            label: tr("release.start"),
            onClick: () => setCreating(true),
          },
        ]}
        columns={{
          // First on the row, like the epic status chip and the Quests
          // table's status dot.
          state: {
            label: tr("release.list.column.state"),
            sortable: true,
            className: "w-32 pl-4",
            cell: (release) => {
              const state = releaseState(release);
              const Icon = STATE_ICONS[state];
              return (
                <Badge variant="tint" tone={STATE_TONE[state]}>
                  <Icon className="size-3" />
                  {tr(STATE_LABEL_KEYS[state])}
                </Badge>
              );
            },
          },
          tag: {
            label: tr("release.list.column.tag"),
            sortable: true,
            // `w-full max-w-0 min-w-48`, copied from the Epics table with its
            // reasoning: auto-layout means `max-width: 0` is what stops this
            // column claiming its content width, `width: 100%` is what makes
            // it absorb the slack, and without the pair the ellipsis never
            // fires.
            className: "w-full max-w-0 min-w-48",
            cell: (release) => {
              // A release with no tag cannot be addressed at all: the tag IS
              // the URL. It should be unreachable (the create schema requires
              // one) but the column is nullable, so the row falls back to
              // inert text rather than to a broken link.
              const tag = release.tag;
              return (
                <div className="flex flex-col overflow-hidden whitespace-nowrap">
                  {tag ? (
                    // A real anchor inside a clickable row, so the browser
                    // owns cmd / shift / middle click and "copy link
                    // address". `stopPropagation` because the row carries
                    // `onRowClick` too: without it a plain click navigates
                    // twice, once through each.
                    <Link
                      href={router.path("projectRelease", {
                        params: { releaseTag: tag },
                      })}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate font-mono text-sm font-medium"
                      title={tag}
                    >
                      {tag}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground truncate font-mono text-sm">
                      #{release.number}
                    </span>
                  )}
                  {/* Only when it says something the tag does not. `title`
                      defaults to the tag server-side, so printing both would
                      show the same string twice. */}
                  {release.title !== tag ? (
                    <span className="text-muted-foreground truncate text-xs">
                      {release.title}
                    </span>
                  ) : null}
                </div>
              );
            },
          },
          progress: {
            label: tr("release.list.column.progress"),
            className: "w-56",
            cell: (release) => <ReleaseProgress release={release} />,
          },
          // One column, two meanings, which is what the old row did too: an
          // open release shows the date it is aiming at, a released one the
          // date it went out. Keeping them apart would leave whichever column
          // did not apply empty on every row.
          targetDate: {
            label: tr("release.list.column.date"),
            sortable: true,
            className: "w-40",
            cell: (release) =>
              release.releasedAt ? (
                <span className="whitespace-nowrap">
                  {tr("release.list.releasedOn", {
                    args: [
                      String(l(release.releasedAt as string, { date: "ll" })),
                    ],
                  })}
                </span>
              ) : release.targetDate ? (
                <span className="text-muted-foreground whitespace-nowrap">
                  {tr("release.list.target", {
                    args: [
                      String(l(release.targetDate as string, { date: "ll" })),
                    ],
                  })}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {tr("release.list.noTarget")}
                </span>
              ),
          },
        }}
      />
    </div>
  );
};

/**
 * ⚠️ Every ordering here resolves to `number`, including the one the header
 * calls "Tag".
 *
 * Semver does not sort as text, so `["0.9.0", "0.28.0"].sort()` yields
 * `0.28.0` first. `number` is the creation sequence, which for releases IS
 * version order, and it is what `ProjectReleases` has always ordered by and
 * what the Epics list sorts on for the same column.
 */
const sortReleases = (
  items: ReleaseResource[],
  sort?: string,
): ReleaseResource[] => {
  const field = sort?.replace(/^-/, "");
  const dir = sort?.startsWith("-") ? -1 : 1;
  const rows = [...items];
  rows.sort((a, b) => {
    if (field === "state") {
      // Open before released ascending, which walks the lifecycle the way
      // the epic status sort does rather than sorting the two words.
      const rank = (release: ReleaseResource) => (release.releasedAt ? 1 : 0);
      return (rank(a) - rank(b)) * dir || a.number - b.number;
    }
    if (field === "targetDate") {
      // The column shows `releasedAt` for a shipped release and
      // `targetDate` otherwise, so it sorts on whichever it is showing.
      // A release with neither sorts last in both directions, for the same
      // reason an epic with no release does on the Epics list: most rows
      // would otherwise drag through the middle on every flip.
      const at = a.releasedAt ?? a.targetDate;
      const bt = b.releasedAt ?? b.targetDate;
      if (!at || !bt) {
        if (!at && !bt) return a.number - b.number;
        return at ? -1 : 1;
      }
      return (
        (new Date(at as string).getTime() - new Date(bt as string).getTime()) *
          dir || a.number - b.number
      );
    }
    // `tag` and the fallback both land here.
    return (a.number - b.number) * dir;
  });
  return rows;
};

export default ProjectReleases;
