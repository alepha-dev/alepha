import {
  type WikiLinkPreviewProps,
  formatReference,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";

/**
 * A feedback item's hover card: its reference, title and status.
 */
const FeedbackReferencePreview = (props: WikiLinkPreviewProps) => {
  const feedbackApi = useClient<FeedbackController>();
  const { projectId, id } = props;

  const query = useQuery<FeedbackPreviewData>(
    {
      key: ["wikilink-preview", projectId, `feedback:${id}`],
      staleTime: [5, "minutes"],
      handler: async () => {
        const item = await feedbackApi.getFeedbackByShortId({
          params: { projectId, shortId: Number(id) },
        });
        return {
          title: item.title,
          status: item.status,
          shortId: item.shortId,
        };
      },
      onError: () => {},
    },
    [feedbackApi, projectId, id],
  );

  const item = query.data;
  if (!item) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("feedback", item.shortId)}
        </span>
        <span className="text-sm font-semibold">{item.title}</span>
      </div>
      <div className="text-muted-foreground text-xs">{item.status}</div>
    </div>
  );
};

export default FeedbackReferencePreview;

interface FeedbackPreviewData {
  title: string;
  status: string;
  shortId: number;
}
