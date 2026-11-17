import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { FileWarning } from "lucide-react";

import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import {
  REQUIREMENT_STATUS_ICONS,
  REQUIREMENT_STATUS_LABEL_KEYS,
  REQUIREMENT_STATUS_TONE,
} from "./requirementLabels.ts";

export interface RequirementStatusChipsProps {
  requirement: Pick<RequirementResource, "status" | "sourceChanged">;
}

/**
 * A requirement's computed status, with the Source changed chip beside it
 * (#E153). A glyph and a tone each, as an epic's status chip.
 */
const RequirementStatusChips = (props: RequirementStatusChipsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = REQUIREMENT_STATUS_ICONS[props.requirement.status];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge
        variant="tint"
        tone={REQUIREMENT_STATUS_TONE[props.requirement.status]}
      >
        <Icon className="size-3" />
        {tr(REQUIREMENT_STATUS_LABEL_KEYS[props.requirement.status])}
      </Badge>
      {props.requirement.sourceChanged ? (
        <Badge variant="tint" tone="warning" data-testid="source-changed">
          <FileWarning className="size-3" />
          {tr("requirements.requirement.sourceChanged")}
        </Badge>
      ) : null}
    </span>
  );
};

export default RequirementStatusChips;
