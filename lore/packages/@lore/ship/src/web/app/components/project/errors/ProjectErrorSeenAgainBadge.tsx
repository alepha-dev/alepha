import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface ProjectErrorSeenAgainBadgeProps {
  /**
   * When the error was resolved. With it the badge says since when, which
   * is what the error's page shows; the inbox keeps the short form.
   */
  resolvedAt?: string;
}

/**
 * A resolved error its app reported again: the fix did not hold. Lore does
 * not reopen an error an app reports, so this mark is how it shows.
 */
const ProjectErrorSeenAgainBadge = (props: ProjectErrorSeenAgainBadgeProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  return (
    <Badge variant="tint" tone="warning" data-testid="error-seen-again">
      {props.resolvedAt
        ? tr("errors.seenAgain.since", {
            args: [l(props.resolvedAt, { date: "lll" })],
          })
        : tr("errors.seenAgain.label")}
    </Badge>
  );
};

export default ProjectErrorSeenAgainBadge;
