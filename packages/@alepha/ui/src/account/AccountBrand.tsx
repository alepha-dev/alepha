import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";

import { UserAvatar } from "../core/UserAvatar.tsx";

export interface AccountBrandProps {
  /**
   * Line under the name. Defaults to the translated "Account", so the header
   * says whose area this is and what it is.
   */
  subtitle?: string;
}

/**
 * The account sidebar's default header: the signed-in user's avatar and
 * display name, collapsing to the avatar alone when the sidebar folds to its
 * icon rail.
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
  const user = auth.user;
  const name = user?.name ?? user?.username ?? user?.email ?? "";

  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
      <UserAvatar fileId={user?.picture} className="size-7" alt={name} />
      <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
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
    </div>
  );
};
