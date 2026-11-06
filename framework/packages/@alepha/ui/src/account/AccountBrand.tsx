import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import { UserAvatar } from "../core/UserAvatar.tsx";
import { SidebarBackHeader } from "../shell/SidebarBackHeader.tsx";

export interface AccountBrandProps {
  /**
   * Line under the name. Defaults to the translated "Account", so the header
   * says whose area this is and what it is.
   */
  subtitle?: string;
  /**
   * Route name the header's back arrow leads to: the application's home,
   * since the account shell hides the application's own chrome.
   *
   * @default "home"
   */
  homeRouteName?: string;
}

/**
 * The account sidebar's default header: a back arrow home, then the
 * signed-in user's avatar and display name, collapsing to the arrow alone
 * when the sidebar folds to its icon rail.
 *
 * The account area is the user's own, so the header says whose it is rather
 * than repeating the application's name. An application that wants its own
 * mark there passes `brand` on `accountRouterOptionsAtom`, as Lore does.
 *
 * ⚠️ Imported only from `AccountLayout`, the lazy chunk. `AccountRouter` is
 * evaluated eagerly in the server graph, where a component import would drag
 * this file into the migration generator's classic-JSX `tsx` run (see the
 * router's own JSDoc).
 */
export const AccountBrand = (props: AccountBrandProps) => {
  const auth = useAuth();
  const { tr } = useI18n();
  const router = useRouter<any>();
  const user = auth.user;
  const name = user?.name ?? user?.username ?? user?.email ?? "";

  return (
    <SidebarBackHeader
      href={router.path(props.homeRouteName ?? "home")}
      label={tr("account.nav.backToSite", { default: "Back to site" })}
    >
      <UserAvatar fileId={user?.picture} className="size-7" alt={name} />
      <div className="flex min-w-0 flex-col">
        <span
          className="truncate text-sm font-semibold tracking-tight"
          data-testid="account-brand-name"
        >
          {name}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {props.subtitle ??
            tr("account.brand.subtitle", { default: "Account" })}
        </span>
      </div>
    </SidebarBackHeader>
  );
};
