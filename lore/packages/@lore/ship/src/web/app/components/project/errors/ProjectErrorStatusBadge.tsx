import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";

export interface ProjectErrorStatusBadgeProps {
  status: string;
  /**
   * Also say `Open`. The inbox leaves it out, since open is what it lists;
   * the error's own page says where the error stands whatever that is.
   */
  showOpen?: boolean;
}

/**
 * Where an error stands: open, resolved, or forwarded to a quest.
 *
 * The status of a forwarded error carries the quest's database id after its
 * prefix, not its per-project number, so the badge says only that it was
 * forwarded (epic #32): the quest itself is named where it can be linked.
 */
const ProjectErrorStatusBadge = (props: ProjectErrorStatusBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (props.status === "resolved") {
    return (
      <Badge variant="secondary" data-testid="error-status">
        {tr("errors.status.resolved")}
      </Badge>
    );
  }
  if (props.status.startsWith(QUEST_STATUS_PREFIX)) {
    return (
      <Badge variant="outline" data-testid="error-status">
        {tr("errors.status.quest")}
      </Badge>
    );
  }
  if (!props.showOpen) return null;
  return (
    <Badge variant="tint" tone="warning" data-testid="error-status">
      {tr("errors.status.open")}
    </Badge>
  );
};

export default ProjectErrorStatusBadge;
