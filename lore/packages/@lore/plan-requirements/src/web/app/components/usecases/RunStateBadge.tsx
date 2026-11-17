import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Clock } from "lucide-react";

import type { UseCaseRunState } from "../../../../api/schemas/useCaseRunStateSchema.ts";
import {
  RUN_STATE_ICONS,
  RUN_STATE_LABEL_KEYS,
  RUN_STATE_TONE,
} from "./useCaseLabels.ts";

export interface RunStateBadgeProps {
  state: UseCaseRunState;
  stale?: boolean;
}

/**
 * A use case's last result (#E153): Passed, Failed, In development (a
 * failure while a covering quest is open) or Never run, and Stale beside it.
 * A glyph and a tone each, as a quest's status chip.
 */
const RunStateBadge = (props: RunStateBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = RUN_STATE_ICONS[props.state];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="tint" tone={RUN_STATE_TONE[props.state]}>
        <Icon className="size-3" />
        {tr(RUN_STATE_LABEL_KEYS[props.state])}
      </Badge>
      {props.stale ? (
        <Badge variant="tint" tone="warning">
          <Clock className="size-3" />
          {tr("requirements.run.stale")}
        </Badge>
      ) : null}
    </span>
  );
};

export default RunStateBadge;
