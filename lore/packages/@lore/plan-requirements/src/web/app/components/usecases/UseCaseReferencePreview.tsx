import {
  formatReference,
  type I18n,
  type WikiLinkPreviewProps,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { USE_CASE_STATUS_LABEL_KEYS } from "./useCaseLabels.ts";

/**
 * A use case's hover card (#E153): its reference, title, status, actors and
 * how many criteria it holds.
 */
const UseCaseReferencePreview = (props: WikiLinkPreviewProps) => {
  const useCaseApi = useClient<UseCaseController>();
  const { tr } = useI18n<I18n, "en">();
  const { projectId, id } = props;

  const query = useQuery<UseCaseResource>(
    {
      key: ["wikilink-preview", projectId, `usecase:${id}`],
      staleTime: [5, "minutes"],
      handler: async () =>
        await useCaseApi.getUseCaseByNumber({
          params: { projectId, number: Number(id) },
        }),
      onError: () => {},
    },
    [useCaseApi, projectId, id],
  );

  const useCase = query.data;
  if (!useCase) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("usecase", useCase.number)}
        </span>
        <span className="text-sm font-semibold">{useCase.title}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        <span>{tr(USE_CASE_STATUS_LABEL_KEYS[useCase.status])}</span>
        {useCase.actors.length ? (
          <span>· {useCase.actors.map((a) => a.name).join(", ")}</span>
        ) : null}
        <span>
          ·{" "}
          {tr("requirements.usecase.criteriaCount", {
            args: [String(useCase.criteria.length)],
          })}
        </span>
      </div>
    </div>
  );
};

export default UseCaseReferencePreview;
