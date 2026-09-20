import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { History } from "lucide-react";
import { useState } from "react";

import type { HomeController } from "@/api/controllers/HomeController.ts";
import type { HomeActivityRow } from "@/api/schemas/homeActivityRowSchema.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import { HomeActivityLine } from "./HomeActivityLine.tsx";

export interface HomeActivityPanelProps {
  /**
   * The most recent events across every project, from `getHomeBoard`.
   */
  rows: HomeActivityRow[];
  projects: ProjectOverviewResource[];
  loading: boolean;
}

/**
 * The picker's one field: a project id as the select holds it, a string, and
 * absent for every project.
 */
const projectPickSchema = z.object({
  projectId: z.text().optional(),
});

/**
 * What has happened lately, across every project you belong to, or in one.
 *
 * ## Picking a project reads that project
 *
 * The board's lines are the most recent events across ALL projects, so
 * filtering them would show a quiet project few lines or none. Picking one in
 * the header instead asks the server for that project's own last twenty
 * (`getHomeActivity`), keyed per project so going back to one already read
 * costs nothing.
 *
 * ## A quick view, not a preference
 *
 * The pick is not persisted: the page always opens on every project. It is a
 * look at one project from Home, and somebody who wants to stay on one
 * project's history has its Activity page.
 */
export const HomeActivityPanel = (props: HomeActivityPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const homeApi = useClient<HomeController>();
  const slugs = new Map(
    props.projects.map((project) => [project.id, project.slug]),
  );

  const pick = useForm({
    schema: projectPickSchema,
    initialValues: {},
    keepDirty: false,
    handler: async () => {},
  });
  const picked = useFormValues(pick).projectId as string | undefined;
  const projectId = picked ? Number(picked) : undefined;

  const projectActivity = useQuery(
    {
      key: ["home-activity", projectId ?? 0],
      enabled: projectId !== undefined,
      handler: () =>
        homeApi.getHomeActivity({ query: { projectId: projectId as number } }),
    },
    [homeApi, projectId],
  );

  const rows =
    projectId === undefined ? props.rows : (projectActivity.data ?? []);
  const loading =
    projectId === undefined ? props.loading : projectActivity.loading;

  // One line open at a time, as in Folio History: opening another closes it.
  const [expandedId, setExpandedId] = useState<HomeActivityRow["id"] | null>(
    null,
  );

  return (
    <aside
      data-testid="home-activity"
      // The right half of one block with the table, inside the page's grid:
      // its top, right and bottom edges are the grid's own rules, so the one
      // border it draws is the left one, the line between it and the table.
      className="hidden w-88 shrink-0 flex-col overflow-hidden border-l lg:flex"
    >
      {/* `bg-muted` AND the `--bevel` fold on its top edge, which is the
          whole of the kit's chrome: this band is the panel's toolbar, and
          the filter bar beside it carries both. With the fill alone it was
          the same colour with none of the volume.

          ⚠️ 53px, the filter bar's own height, so the two rules across the
          page are one line: the bar is 8px of padding, a 36px control, 8px
          of padding and its 1px rule, and this band is that figure with its
          own rule inside it (`border-box`).

          It was 49px while both halves drew a full border and the panel's
          top one pushed this band down; on Home neither does since the grid
          took over their edges, so the number is the bar's height flat. A
          control of another size moves it, and the line is where anyone
          would see it. */}
      <div className="bg-muted text-muted-foreground flex h-[53px] shrink-0 items-center gap-2 border-b pr-4 pl-4 text-[11px] tracking-[0.18em] uppercase shadow-[inset_0_1px_0_0_var(--bevel)]">
        <History className="size-3.5 shrink-0" />
        <span className="flex-1 truncate">{tr("home.activity.title")}</span>
        {/* `normal-case` and no tracking: the heading's small caps are for
            the heading, and a project name in them reads as a label rather
            than as a value. Sized to its label, with no cap: a title is at
            most 24 characters, and the heading beside it is the one that
            truncates. */}
        <div className="shrink-0 tracking-normal normal-case">
          <Control
            input={pick.input.projectId}
            label=""
            size="xs"
            minimal
            // ⚠️ `w-auto`, or the label truncates in a box sized to fit it.
            // The default `w-full` resolves against this content-sized
            // wrapper, and `minimal`'s `-mx-1` takes 8px off the size the
            // wrapper measures, so the trigger came out 8px short of its own
            // text: "All proje...". `QuestReleaseControl` does the same.
            triggerClassName="w-auto"
            clearable
            clearLabel={tr("home.activity.allProjects")}
            popupClassName="w-max min-w-48"
            inputProps={{
              "data-testid": "home-activity-project",
              "aria-label": tr("home.table.col.project"),
            }}
            items={props.projects.map((project) => ({
              value: String(project.id),
              label: project.title,
            }))}
          />
        </div>
      </div>
      {/* ⚠️ `relative` is load-bearing. Every line's details carry
          `sr-only` labels, which are `position: absolute`, and an absolute
          box is clipped and scrolled by an overflow container only when it
          has a positioned ancestor inside it. Without one, the labels of the
          lines far down this list escaped it and stretched the DOCUMENT, so
          the whole page scrolled and left blank space under the panel. */}
      <div className="divide-border relative min-h-0 flex-1 divide-y overflow-y-auto">
        {rows.map((row) => (
          <HomeActivityLine
            key={row.id}
            row={row}
            projectSlug={slugs.get(row.projectId)}
            filtered={projectId !== undefined}
            expanded={expandedId === row.id}
            onToggle={() =>
              setExpandedId(expandedId === row.id ? null : row.id)
            }
          />
        ))}
        {rows.length === 0 && !loading && (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            {projectId === undefined
              ? tr("home.activity.empty")
              : tr("home.activity.empty.project")}
          </p>
        )}
      </div>
    </aside>
  );
};
