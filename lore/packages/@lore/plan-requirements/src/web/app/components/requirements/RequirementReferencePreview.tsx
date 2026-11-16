import {
  formatReference,
  type I18n,
  type WikiLinkPreviewProps,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import {
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_STATUS_LABEL_KEYS,
} from "./requirementLabels.ts";

/**
 * A requirement's hover card (#E153): reference, paragraph, statement,
 * priority and status.
 */
const RequirementReferencePreview = (props: WikiLinkPreviewProps) => {
  const requirementApi = useClient<RequirementController>();
  const { tr } = useI18n<I18n, "en">();
  const { projectId, id } = props;

  const query = useQuery<RequirementResource>(
    {
      key: ["wikilink-preview", projectId, `requirement:${id}`],
      staleTime: [5, "minutes"],
      handler: async () =>
        await requirementApi.getRequirementByNumber({
          params: { projectId, number: Number(id) },
        }),
      onError: () => {},
    },
    [requirementApi, projectId, id],
  );

  const it = query.data;
  if (!it) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("requirement", it.number)}
          {it.paragraph ? ` §${it.paragraph}` : ""}
        </span>
        <span className="text-sm font-semibold">{it.statement}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        <span>{tr(REQUIREMENT_PRIORITY_LABEL_KEYS[it.priority])}</span>
        <span>· {tr(REQUIREMENT_STATUS_LABEL_KEYS[it.status])}</span>
      </div>
    </div>
  );
};

export default RequirementReferencePreview;
