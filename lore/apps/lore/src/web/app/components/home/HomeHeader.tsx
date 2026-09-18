import { ButtonInbox } from "@alepha/ui/shell";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

/**
 * The landing page's header bar: the realm on the left, the ambient controls
 * on the right.
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
    <header className="flex h-14 shrink-0 items-center gap-3 px-4">
      <LoreLogo size={22} className="size-[22px]" />
      <span className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
        {tr("home.wordmark")}
      </span>
      <span className="flex-1" />
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
