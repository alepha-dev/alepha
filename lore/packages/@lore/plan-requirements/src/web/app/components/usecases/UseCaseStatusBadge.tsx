import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseStatus } from "../../../../api/schemas/useCaseStatusSchema.ts";
import {
  USE_CASE_STATUS_ICONS,
  USE_CASE_STATUS_LABEL_KEYS,
  USE_CASE_STATUS_TONE,
} from "./useCaseLabels.ts";

export interface UseCaseStatusBadgeProps {
  status: UseCaseStatus;
}

/**
 * A use case's status chip (#E153): one tone and one glyph per status, as an
 * epic's.
 */
const UseCaseStatusBadge = (props: UseCaseStatusBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = USE_CASE_STATUS_ICONS[props.status];
  return (
    <Badge variant="tint" tone={USE_CASE_STATUS_TONE[props.status]}>
      <Icon className="size-3" />
      {tr(USE_CASE_STATUS_LABEL_KEYS[props.status])}
    </Badge>
  );
};

export default UseCaseStatusBadge;
