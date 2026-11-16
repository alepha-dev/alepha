import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseStatus } from "../../../../api/schemas/useCaseStatusSchema.ts";
import { USE_CASE_STATUS_LABEL_KEYS } from "./useCaseLabels.ts";

export interface UseCaseStatusBadgeProps {
  status: UseCaseStatus;
}

/**
 * A use case's status chip (#E153), one tone per status.
 */
const UseCaseStatusBadge = (props: UseCaseStatusBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const tone = (
    {
      draft: "neutral",
      ready: "info",
      validated: "success",
      deprecated: "warning",
    } as const
  )[props.status];
  return (
    <Badge variant="tint" tone={tone}>
      {tr(USE_CASE_STATUS_LABEL_KEYS[props.status])}
    </Badge>
  );
};

export default UseCaseStatusBadge;
