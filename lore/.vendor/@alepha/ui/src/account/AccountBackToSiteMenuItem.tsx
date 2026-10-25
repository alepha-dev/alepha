import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";

import { DropdownMenuItem } from "../core/DropdownMenu.tsx";

export interface AccountBackToSiteMenuItemProps {
  /**
   * Route name the item links to.
   *
   * @default "home"
   */
  routeName?: string;
}

/**
 * "Back to site" in the account menu: the way out of the account shell for
 * everybody.
 *
 * `AdminLayout` reuses the menu's admin item for its way out, which works
 * there because everyone inside `/admin` holds `admin:ui`. Inside `/account`
 * most people do not, and that item hides itself for them, so the account
 * shell carries its own. A real `<Link href>`, so middle-click and "open in
 * new tab" work, and hidden when the route is not mounted rather than
 * linking to a 404.
 */
export const AccountBackToSiteMenuItem = (
  props: AccountBackToSiteMenuItemProps,
) => {
  const router = useRouter<any>();
  const { tr } = useI18n();
  const routeName = props.routeName ?? "home";
  if (!router.pages?.some((page: any) => page.name === routeName)) {
    return null;
  }

  return (
    <DropdownMenuItem
      render={<Link href={router.path(routeName)} />}
      data-testid="account-back-to-site"
    >
      <ArrowLeft className="size-4" />
      {tr("account.nav.backToSite", { default: "Back to site" })}
    </DropdownMenuItem>
  );
};
