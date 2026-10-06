import {
  type WikiLinkPreviewProps,
  formatReference,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

/**
 * A quest's hover card: its reference, title, area, priority and status.
 * Cached five minutes per reference, quiet on failure, like every preview
 * (`FolioReferencePreview`).
 */
const QuestReferencePreview = (props: WikiLinkPreviewProps) => {
  const questApi = useClient<QuestController>();
  const { projectId, id } = props;

  const query = useQuery<QuestResource>(
    {
      key: ["wikilink-preview", projectId, `quest:${id}`],
      staleTime: [5, "minutes"],
      handler: async () =>
        (await questApi.getQuestByShortId({
          params: { projectId, shortId: Number(id) },
        })) as QuestResource,
      onError: () => {},
    },
    [questApi, projectId, id],
  );

  const quest = query.data;
  if (!quest) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("quest", quest.shortId)}
        </span>
        <span className="text-sm font-semibold">{quest.title}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        {quest.area && <span>{quest.area}</span>}
        {quest.priority && <span>· {quest.priority}</span>}
        {quest.metadata.status && <span>· {quest.metadata.status}</span>}
      </div>
    </div>
  );
};

export default QuestReferencePreview;
