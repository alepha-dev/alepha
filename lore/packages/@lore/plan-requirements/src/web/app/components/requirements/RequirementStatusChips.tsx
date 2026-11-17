import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { REQUIREMENT_STATUS_LABEL_KEYS } from "./requirementLabels.ts";

export interface RequirementStatusChipsProps {
  requirement: Pick<RequirementResource, "status" | "sourceChanged">;
}

/**
 * A requirement's computed status, with the Source changed chip beside it
 * (#E153). Stale arrives with runs.
 */
const RequirementStatusChips = (props: RequirementStatusChipsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const tone = (
    {
      verified: "success",
      failing: "danger",
      in_development: "info",
      covered: "info",
      not_covered: "neutral",
      no_data: "neutral",
    } as const
  )[props.requirement.status];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="tint" tone={tone}>
        {tr(REQUIREMENT_STATUS_LABEL_KEYS[props.requirement.status])}
      </Badge>
      {props.requirement.sourceChanged ? (
        <Badge variant="tint" tone="warning" data-testid="source-changed">
          {tr("requirements.requirement.sourceChanged")}
        </Badge>
      ) : null}
    </span>
  );
};

export default RequirementStatusChips;
