import { $pageAccount, AccountRouter } from "@alepha/ui/account";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { MessageSquareWarning } from "lucide-react";
import { createElement } from "react";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";

/**
 * Work's page in the account area: the feedback the signed-in user sent
 * (#E75, #Q2624). Mounted under the framework's account layout by
 * `$pageAccount`, like core's `LoreAccountRouter`, so core lists no Work page.
 */
export class WorkAccountRouter {
  protected readonly account = $inject(AccountRouter);
  protected readonly feedbackApi = $client<FeedbackController>();

  /**
   * ⚠️ **The route name `myFeedback` is deliberately NOT `accountFeedback`.**
   *
   * It predates this migration, is referenced as a plain string by call sites
   * and by `apps/lore/CLAUDE.md`, and `router.path("myFeedback")` silently
   * widens to the plain `string` overload the moment the name stops existing
   * — no type error, a render-time throw in production instead. The path
   * moved from `/auth/profile/feedback` to `/account/feedback`; the name did
   * not move at all.
   *
   * This page is also the deliberate dogfood for `$pageAccount`: if the seam
   * is wrong, it shows up here before it shows up in anyone else's app.
   */
  myFeedback = $pageAccount({
    path: "/feedback",
    name: "myFeedback",
    head: this.account.accountHead("My feedback"),
    can: () => this.feedbackApi.listMyFeedback.can(),
    nav: {
      label: "Feedback",
      icon: createElement(MessageSquareWarning),
      group: "Lore",
      order: 102,
    },
    lazy: () => import("./MyFeedback.tsx"),
  });
}
