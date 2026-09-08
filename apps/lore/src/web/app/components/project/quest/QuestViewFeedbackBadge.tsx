import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Inbox } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import { useFeedbackReference } from "./useFeedbackReference.ts";

export interface QuestViewFeedbackBadgeProps {
  /**
   * `quests.feedbackId`, the feedback row's database id. The number a reader
   * knows is resolved from it - see {@link useFeedbackReference}.
   */
  feedbackId: number;
}

/**
 * The chip saying this quest was promoted from a feedback item, and the link
 * to the item.
 *
 * It used to be a dead badge reading "from feedback": it told the reader the
 * provenance existed and then left them to find it by hand in an inbox
 * filtered to `pending`, where a promoted item - `accepted` by definition -
 * is not even listed.
 *
 * An anchor rather than a `router.push` button: this is a destination, so it
 * keeps middle-click and open-in-new-tab, which is what somebody comparing a
 * quest against the report it came from actually does. `Link` rather than a
 * bare `<a>`, so an ordinary click stays a client-side navigation.
 *
 * The unresolved shape is deliberate rather than a loading state. It is what
 * the badge was before, so it is correct on its own: a number is a promise
 * that the link works, and while the read is in flight, or after it failed
 * because the item is gone or the reader's rank does not open the inbox,
 * there is no such promise to make. A spinner on a chip this size would say
 * more about the request than about the quest.
 */
const QuestViewFeedbackBadge = (props: QuestViewFeedbackBadgeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { reference, href } = useFeedbackReference(props.feedbackId);

  if (!reference || !href) {
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        <Inbox className="size-3" />
        {tr("quest.view.fromFeedback")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="text-muted-foreground hover:text-foreground"
      render={<Link href={href} />}
    >
      <Inbox className="size-3" />
      {tr("quest.view.fromFeedbackRef", { args: [reference] })}
    </Badge>
  );
};

export default QuestViewFeedbackBadge;
