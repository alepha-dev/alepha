import {
  type WikiLinkPreviewProps,
  type I18n,
  formatReference,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EpicController } from "@/api/controllers/EpicController.ts";

import { type EpicStatus, STATUS_LABEL_KEYS } from "./epicStatus.ts";

/**
 * An epic's hover card: its reference, title, status and quest rollup.
 *
 * The status is rendered through `STATUS_LABEL_KEYS`, never printed raw:
 * `in_progress` is a stored value, not something to show a reader. The
 * rollup is `completed / total` quests, the one the Epics list shows.
 */
const EpicReferencePreview = (props: WikiLinkPreviewProps) => {
  const epicApi = useClient<EpicController>();
  const { tr } = useI18n<I18n, "en">();
  const { projectId, id } = props;

  const query = useQuery<EpicPreviewData>(
    {
      key: ["wikilink-preview", projectId, `epic:${id}`],
      staleTime: [5, "minutes"],
      handler: async () => {
        const epic = await epicApi.getEpicByNumber({
          params: { projectId, number: Number(id) },
        });
        return {
          title: epic.title,
          number: epic.number,
          status: epic.status,
          completed: epic.progress.completed,
          total: epic.progress.total,
        };
      },
      onError: () => {},
    },
    [epicApi, projectId, id],
  );

  const epic = query.data;
  if (!epic) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("epic", epic.number)}
        </span>
        <span className="text-sm font-semibold">{epic.title}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        <span>{tr(STATUS_LABEL_KEYS[epic.status])}</span>
        <span>
          · {epic.completed}/{epic.total}
        </span>
      </div>
    </div>
  );
};

export default EpicReferencePreview;

interface EpicPreviewData {
  title: string;
  number: number;
  status: EpicStatus;
  completed: number;
  total: number;
}
