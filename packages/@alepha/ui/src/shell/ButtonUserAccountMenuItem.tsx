import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { Link, useRouter } from "alepha/react/router";
import { CircleUser } from "lucide-react";

import { DropdownMenuItem } from "../core/DropdownMenu.tsx";

export interface ButtonUserAccountMenuItemProps {
  /**
   * Route name to link to. Defaults to `"account"`, which is what
   * `AccountRouter` registers — set it only if you mounted the account area
   * under a different name.
   */
  routeName?: string;

  /**
   * Escape hatch for a destination no route name can express. Supplying it
   * turns the item back into a click handler on a `div`, giving up everything
   * an anchor provides.
   */
  onClick?: () => void;

  /**
   * Item label. Defaults to `"User Account"`.
   */
  label?: string;
}

/**
 * Link to the signed-in user's own account area.
 *
 * ⚠️ **It owns its destination, unlike {@link ButtonUser.AdminMenuItem}.**
 * That asymmetry is deliberate. Every caller that hard-coded this navigation
 * got it wrong the moment the account area moved — `router.push("me")` kept
 * compiling after the `me` route ceased to exist, because `router.push` falls
 * back to a plain `string` overload, and threw only when someone clicked it.
 * Defaulting to the route `AccountRouter` actually registers removes the whole
 * class of bug; `onClick` stays available for an application that mounted the
 * area itself under another name.
 *
 * **It hides itself when no `account` route is registered**, so an application
 * that never mounts `AccountRouter` gets no dead entry — the same "is the
 * module actually there" question the router's own `can` gates answer, asked
 * the only way a menu item can ask it.
 *
 * ⚠️ **It renders an `<a href>`, not a click handler**, because it is a
 * destination rather than an action. `DropdownMenuItem` is a Base UI
 * `Menu.Item`, which defaults to a `div` — correct for Logout, wrong here: a
 * div navigating from `onClick` cannot be ⌘-clicked, middle-clicked or opened
 * in a new tab, shows no target on hover, and offers no "copy link address".
 * `render` swaps the element while Base UI keeps `role="menuitem"` and its
 * keyboard handling, so the menu semantics are unchanged.
 */
export const ButtonUserAccountMenuItem = (
  props: ButtonUserAccountMenuItemProps,
) => {
  const auth = useAuth();
  const router = useRouter<any>();

  if (!auth.user) {
    return null;
  }

  const label = (
    <>
      <CircleUser className="size-4" />
      {props.label ?? "User Account"}
    </>
  );

  if (props.onClick) {
    return <DropdownMenuItem onClick={props.onClick}>{label}</DropdownMenuItem>;
  }

  // No account area mounted → no entry, rather than one that 404s on click.
  const routeName = props.routeName ?? "account";
  if (!router.pages?.some((page: any) => page.name === routeName)) {
    return null;
  }

  return (
    <DropdownMenuItem render={<Link href={router.path(routeName)} />}>
      {label}
    </DropdownMenuItem>
  );
};
