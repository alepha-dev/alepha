import { Progress } from "@alepha/ui/components/ui/progress";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import EpicStatusControl from "./EpicStatusControl.tsx";

export interface ProjectEpicHeaderProps {
  epic: EpicResource;
  onStatusChange: (epic: EpicResource) => void;
}

/**
 * Zone 1 of the Epic page: number + title, the status control, and the
 * progress bar over the epic's own quests. The rollup is ungated by design
 * (`EpicController.buildEpicResource`) — every quest in the epic counts,
 * planned ones included.
 */
const ProjectEpicHeader = (props: ProjectEpicHeaderProps) => {
  const pct =
    props.epic.progress.total > 0
      ? Math.round(
          (props.epic.progress.completed / props.epic.progress.total) * 100,
        )
      : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-muted-foreground shrink-0 font-mono text-sm">
            #{props.epic.number}
          </span>
          <h1 className="truncate text-xl font-semibold">{props.epic.title}</h1>
        </div>
        <EpicStatusControl epic={props.epic} onChange={props.onStatusChange} />
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} className="w-48" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {props.epic.progress.completed}/{props.epic.progress.total}
        </span>
      </div>
    </div>
  );
};

export default ProjectEpicHeader;
