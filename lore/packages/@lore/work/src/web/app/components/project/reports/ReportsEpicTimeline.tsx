import type { ReportsPlanning } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

export interface ReportsEpicTimelineProps {
  epics: ReportsPlanning["epics"];
}

/**
 * Each epic from its start to its completion, on one shared axis. An epic in
 * flight runs up to today, dashed, with its age beside it.
 */
const ReportsEpicTimeline = (props: ReportsEpicTimelineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();

  const end = (epic: ReportsPlanning["epics"][number]) =>
    Date.parse(epic.startedAt) + epic.daysInProgress * 86_400_000;
  const min = Math.min(...props.epics.map((it) => Date.parse(it.startedAt)));
  const max = Math.max(...props.epics.map(end));
  const span = Math.max(max - min, 1);

  return (
    <ul className="flex flex-col gap-1.5" data-testid="reports-epic-timeline">
      {props.epics.map((epic) => {
        const left = ((Date.parse(epic.startedAt) - min) / span) * 100;
        const width = ((end(epic) - Date.parse(epic.startedAt)) / span) * 100;
        return (
          <li
            key={epic.id}
            className="grid grid-cols-[minmax(0,14rem)_1fr_4rem] items-center gap-3 text-xs"
          >
            <a
              {...router.anchor("projectEpic", {
                params: {
                  projectSlug: router.state.params.projectSlug,
                  epicNumber: String(epic.number),
                },
              })}
              className="truncate hover:underline"
            >
              {epic.title}
            </a>
            <div className="bg-muted relative h-3 rounded-sm">
              <div
                className={
                  epic.completedAt
                    ? "bg-chart-1 absolute inset-y-0 rounded-sm"
                    : "border-chart-1 absolute inset-y-0 rounded-sm border border-dashed"
                }
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.5)}%`,
                }}
              />
            </div>
            <span className="text-muted-foreground text-right tabular-nums">
              {tr("reports.backlog.days", {
                args: [String(Math.round(epic.daysInProgress))],
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default ReportsEpicTimeline;
