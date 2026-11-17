import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCasePriority } from "../../../../api/schemas/useCasePrioritySchema.ts";
import {
  USE_CASE_PRIORITY_ICONS,
  USE_CASE_PRIORITY_LABEL_KEYS,
  USE_CASE_PRIORITY_TONE,
} from "./useCaseLabels.ts";

export interface UseCasePriorityBadgeProps {
  priority: UseCasePriority;
}

/**
 * A use case's priority chip (#E153), toned and marked like a quest's.
 */
const UseCasePriorityBadge = (props: UseCasePriorityBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = USE_CASE_PRIORITY_ICONS[props.priority];
  return (
    <Badge variant="tint" tone={USE_CASE_PRIORITY_TONE[props.priority]}>
      <Icon className="size-3" />
      {tr(USE_CASE_PRIORITY_LABEL_KEYS[props.priority])}
    </Badge>
  );
};

export default UseCasePriorityBadge;
