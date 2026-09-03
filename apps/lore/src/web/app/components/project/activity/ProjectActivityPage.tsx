import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Activity, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { ProjectActivityEvent } from "@/api/schemas/projectActivitySchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import {
  ACTIVITY_FILTER_LABELS,
  ACTIVITY_FILTERS,
  ACTIVITY_GROUP,
  ACTIVITY_WINDOW_LABELS,
  ACTIVITY_WINDOWS,
  type ActivityFilter,
  type ActivityWindow,
} from "./activityEventMeta.ts";
import ProjectActivityRow from "./ProjectActivityRow.tsx";

/**
 * What moved in this project, and the project's landing page.
 *
 * ## No polling, ever
 *
 * This resolves once per (project, window) and again only when the reader
 * presses Refresh. There is deliberately no interval: the QuestGraph
 * incident (folio #1057) was a route loader revalidating once per second
 * for 51 minutes, producing 4,009 identical `/api/_batch` requests from a
 * single browser tab — roughly 35% of that day's account-wide Worker
 * invocations. This page is the one a project opens on, so it is the worst
 * possible place to reintroduce that. The relative timestamps are stamps,
 * not a heartbeat.
 *
 * ## `includeOwn` is true here, and false over MCP
 *
 * The endpoint defaults it off, because the question an agent asks is what
 * OTHER people did while it was away. A human opening their own project is
 * asking the opposite question, and on a solo project the feed is empty
 * without it — every event on Alepha's own busiest morning was the owner's.
 *
 * ## Filtering is client-side
 *
 * The four chips narrow rows already fetched. The window control is the
 * only thing that re-queries, because it is the only one the server can
 * answer differently.
 */
const ProjectActivityPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const projectApi = useClient<ProjectController>();
  const dt = useInject(DateTimeProvider);

  const [windowHours, setWindowHours] = useState<ActivityWindow>(168);
  const [active, setActive] = useState<ActivityFilter[]>([]);

  const { data, loading, error, refetch } = useQuery(
    {
      enabled: !!project,
      key: ["project-activity", project?.id, windowHours],
      keepPreviousData: true,
      handler: async () => {
        if (!project) {
          return undefined;
        }
        // `since` is computed at fetch time rather than held in state, so a
        // Refresh press actually moves the window instead of re-asking the
        // same one. Through `DateTimeProvider`, never `Date.now()`, so the
        // page is travellable like everything else.
        const since = new Date(
          dt.nowMillis() - windowHours * 60 * 60 * 1000,
        ).toISOString();

        return await projectApi.getProjectActivity({
          params: { id: project.id },
          query: { since, limit: 200, includeOwn: true },
        });
      },
    },
    [project?.id, windowHours],
  );

  // Newest first. The service answers oldest-first with a cursor, which is
  // right for an agent paging forward and backwards for a person reading a
  // page: what happened last is what you came to find out.
  const events = useMemo(() => {
    const rows = (data?.events ?? []).toReversed();
    if (active.length === 0) {
      return rows;
    }
    return rows.filter((row) => active.includes(ACTIVITY_GROUP[row.kind]));
  }, [data?.events, active]);

  const groups = useMemo(() => {
    const byDay = new Map<string, ProjectActivityEvent[]>();
    for (const event of events) {
      // The reader's own day, not the stamp's UTC prefix. `at.slice(0, 10)`
      // is a whole day out for anything after 22:00 in Paris, so a row
      // could sit under a heading that disagreed with the local time
      // printed beside it.
      const day = String(dt.of(event.at).format("YYYY-MM-DD"));
      const bucket = byDay.get(day);
      if (bucket) {
        bucket.push(event);
      } else {
        byDay.set(day, [event]);
      }
    }
    return [...byDay.entries()];
  }, [events, dt]);

  const toggle = (filter: ActivityFilter) => {
    setActive((current) =>
      current.includes(filter)
        ? current.filter((entry) => entry !== filter)
        : [...current, filter],
    );
  };

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">{tr("activity.title")}</h1>
        <div className="flex items-center gap-1">
          {ACTIVITY_WINDOWS.map((hours) => (
            <Button
              aria-pressed={hours === windowHours}
              key={hours}
              onClick={() => setWindowHours(hours)}
              size="sm"
              variant={hours === windowHours ? "secondary" : "ghost"}
            >
              {tr(ACTIVITY_WINDOW_LABELS[hours])}
            </Button>
          ))}
          <Button
            aria-label={tr("activity.refresh")}
            disabled={loading}
            onClick={() => void refetch()}
            size="sm"
            variant="ghost"
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {ACTIVITY_FILTERS.map((filter) => (
          <Button
            // These read as tabs otherwise: four ghost buttons in a row with
            // no pressed state look like a tab strip with nothing selected,
            // and "no chip picked" means everything, not nothing.
            aria-pressed={active.includes(filter)}
            key={filter}
            onClick={() => toggle(filter)}
            size="sm"
            variant={active.includes(filter) ? "secondary" : "ghost"}
          >
            {tr(ACTIVITY_FILTER_LABELS[filter])}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="text-destructive text-sm">{tr("activity.error")}</p>
      ) : null}

      {/*
        Two different empty states, because they are two different facts.
        Nothing has EVER happened in this project is a first run and wants
        an explanation; nothing happened in the last three hours is a
        perfectly healthy answer and wants the window control pointed at.
      */}
      {!error && groups.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Activity
            aria-hidden="true"
            className="text-muted-foreground size-8"
          />
          <p className="font-medium">
            {active.length > 0
              ? tr("activity.empty.filtered.title")
              : tr("activity.empty.window.title")}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {active.length > 0
              ? tr("activity.empty.filtered.body")
              : tr("activity.empty.window.body")}
          </p>
        </div>
      ) : null}

      {groups.map(([day, rows]) => (
        <section key={day}>
          <h2 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            {dt.of(rows[0].at).format("ll")}
          </h2>
          {rows.map((event, index) => (
            <ProjectActivityRow
              event={event}
              // Two events can share a millisecond and a kind (a quest
              // accepted and a comment posted by the same write), so the
              // stamp alone is not a key.
              key={`${event.at}-${event.kind}-${index}`}
              projectSlug={project.slug}
            />
          ))}
        </section>
      ))}

      {data?.truncated ? (
        <p className="text-muted-foreground text-xs">
          {tr("activity.truncated")}
        </p>
      ) : null}
    </div>
  );
};

export default ProjectActivityPage;
