import { AccountDialog } from "@alepha/ui/account";
import { $settingsSection } from "@alepha/ui/settings";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { MessageSquareWarning } from "lucide-react";
import { createElement } from "react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";

/**
 * Work's section of the account dialog: the feedback the signed-in user sent
 * (#E75, #E140). Declared against `AccountDialog` like core's
 * `LoreAccountSections`, so core lists no Work section. Opened from a link
 * as `?account=feedback`.
 */
export class WorkAccountSections {
  protected readonly account = $inject(AccountDialog);
  protected readonly feedbackApi = $client<FeedbackController>();

  feedback = $settingsSection({
    dialog: this.account.dialog,
    name: "feedback",
    label: "Feedback",
    labelKey: "account.nav.feedback",
    icon: createElement(MessageSquareWarning),
    group: "Lore",
    groupKey: "account.nav.group.lore",
    order: 102,
    can: () => this.feedbackApi.listMyFeedback.can(),
    lazy: () => import("./MyFeedback.tsx"),
  });
}
