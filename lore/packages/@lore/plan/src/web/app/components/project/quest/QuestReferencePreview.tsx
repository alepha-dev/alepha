import {
  type I18n,
  type WikiLinkPreviewProps,
  formatReference,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { QuestController } from "../../../../../api/controllers/QuestController.ts";
import type { QuestResource } from "../../../../../api/schemas/questResourceSchema.ts";
import { QUEST_STATUS_LABEL_KEYS } from "./questChips.ts";

/**
 * A quest's hover card: its reference, title, status, priority, area and
 * objectives done (#Q4349).
 * Cached five minutes per reference, quiet on failure, like every preview
 * (`FolioReferencePreview`).
 */
const QuestReferencePreview = (props: WikiLinkPreviewProps) => {
  const { tr } = useI18n<I18n, "en">();
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
  const objectives = quest.metadata.objectivesProgress;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("quest", quest.shortId)}
        </span>
        <span className="text-sm font-semibold">{quest.title}</span>
      </div>
      <div
        className="text-muted-foreground flex flex-wrap gap-x-2 text-xs"
        data-testid="quest-preview-facts"
      >
        {[
          tr(QUEST_STATUS_LABEL_KEYS[quest.metadata.status]),
          quest.priority && tr(`dashboard.filterValue.${quest.priority}`),
          quest.area,
          objectives.total > 0 &&
            tr("folios.wikilink.quest.objectives", {
              args: [String(objectives.completed), String(objectives.total)],
            }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
};

export default QuestReferencePreview;
