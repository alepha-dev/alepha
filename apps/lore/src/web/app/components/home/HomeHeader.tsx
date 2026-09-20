import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { ButtonInbox } from "@alepha/ui/shell";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Sparkles } from "lucide-react";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

/**
 * The landing page's header bar: the realm on the left, New Project and the
 * ambient controls on the right.
 *
 * New Project lives here rather than in the table's toolbar: it is the page's
 * one primary action, not a control of the table, and in the toolbar it took
 * the room the filter bar needs.
 *
 * A real bar rather than `PageHeader`, whose two clusters are `fixed` and
 * float over whatever is under them. Home's body is a card that fills the
 * viewport, so a floating cluster would sit on top of the table's own toolbar.
 *
 * The bell is the same `ButtonInbox` a project's header carries, and its count
 * has always been cross-project (see `ProjectInboxButton`): what the shell
 * decides is where you can see it, not what it counts. Here "see all" lands on
 * the account's notifications page, which is the only inbox view that is not
 * inside a project.
 */
const HomeHeader = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();

  return (
    /*
      `px-8` and `border-b`: the rails of the home grid run at `left-4` /
      `right-4`, so the logo and the account button sit 16px INSIDE them -
      the same gap the rails leave to the page edge. 16px of padding would
      put both controls on the rails themselves.
    */
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-8">
      <LoreLogo size={22} className="size-[22px]" />
      <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
        {tr("home.wordmark")}
      </span>
      <span className="flex-1" />
      {/* Icon and label from `sm`, the icon alone on a phone, where the
          header also carries the bell and the account button. The label
          stays in the DOM as `sr-only`, so the link keeps its name, and the
          tooltip names it for sight only where the label is hidden. CSS, not
          a media-query hook, so the server renders the right one. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              render={
                <Link href={router.path("projectCreate")} />
                // A link wearing a button's clothes: `nativeButton={false}`
                // stops Base UI assuming a native <button> (it warns
                // otherwise), and `role` puts back the link semantics its
                // non-native branch would overwrite with `role="button"`.
              }
              nativeButton={false}
              role="link"
              data-testid="home-new-project"
              className="max-sm:size-8 max-sm:px-0"
            />
          }
        >
          <Sparkles className="size-4" />
          <span className="max-sm:sr-only">{tr("home.create-project")}</span>
        </TooltipTrigger>
        <TooltipContent className="sm:hidden">
          {tr("home.create-project")}
        </TooltipContent>
      </Tooltip>
      <ButtonInbox
        seeAllHref="/account/notifications"
        labels={{
          inbox: tr("inbox.title"),
          heading: tr("inbox.title"),
          empty: tr("inbox.empty"),
          markAllRead: tr("inbox.markAllRead"),
          seeAll: tr("inbox.seeAll"),
        }}
        // A push, not a full navigation: Lore has a router, and reloading the
        // document to reach a page one hop away throws the whole SPA away.
        onOpen={(href) => router.push(href as never)}
      />
      <HeaderActions />
    </header>
  );
};

export default HomeHeader;
