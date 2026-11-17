import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { RequirementPriority } from "../../../../api/schemas/requirementPrioritySchema.ts";
import {
  REQUIREMENT_PRIORITY_ICONS,
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_PRIORITY_TONE,
} from "./requirementLabels.ts";

export interface RequirementPriorityBadgeProps {
  priority: RequirementPriority;
}

/**
 * A requirement's priority chip (#E153): Must, Should, Could or Won't, toned
 * and marked like a quest's priority.
 */
const RequirementPriorityBadge = (props: RequirementPriorityBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = REQUIREMENT_PRIORITY_ICONS[props.priority];
  return (
    <Badge variant="tint" tone={REQUIREMENT_PRIORITY_TONE[props.priority]}>
      <Icon className="size-3" />
      {tr(REQUIREMENT_PRIORITY_LABEL_KEYS[props.priority])}
    </Badge>
  );
};

export default RequirementPriorityBadge;
