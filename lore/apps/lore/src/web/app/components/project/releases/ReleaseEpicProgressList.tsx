import { Badge } from "@alepha/ui/components/ui/badge";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

interface EpicRow {
  id: number;
  number: number;
  title: string;
  completed: number;
  total: number;
}

export interface ReleaseEpicProgressListProps {
  releaseId: number;
}

/**
 * The release's epics, each with its own bar.
 *
 * The bar underneath the release's own: which of the big features are done,
 * rather than a single number for the whole thing.
 *
 * ⚠️ Each epic's `completed/total` counts only the quests of that epic **that
 * are in this release** - an epic can carry a quest that names another release
 * - so the epic bars add up to the release bar above them rather than
 * overshooting it.
 *
 * Renders nothing at all when no epic is attached. That is the normal state
 * for a release made of loose quests, and an empty section with a heading
 * reads as something failing to load.
 */
const ReleaseEpicProgressList = (props: ReleaseEpicProgressListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const releaseApi = useClient<ReleaseController>();
  const [epics, setEpics] = useState<EpicRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    releaseApi
      .getReleaseContents({ params: { id: props.releaseId } })
      .then((contents) => {
        if (!cancelled) setEpics(contents.epics);
      })
      // A panel beside the changelog: a failed fetch hides it rather than
      // breaking the sheet around it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.releaseId]);

  if (epics.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{tr("release.detail.epics")}</span>
      {epics.map((epic) => (
        <div key={epic.id} className="flex items-center gap-2">
          <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
            #{epic.number}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {epic.title}
          </span>
          <span className="bg-muted h-1 w-16 shrink-0 overflow-hidden rounded-full">
            <span
              className="block h-full rounded-full bg-green-600"
              style={{
                width: `${
                  epic.total > 0
                    ? Math.round((epic.completed / epic.total) * 100)
                    : 0
                }%`,
              }}
            />
          </span>
          <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
            {epic.completed}/{epic.total}
          </span>
        </div>
      ))}
    </div>
  );
};

export default ReleaseEpicProgressList;
