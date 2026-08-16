import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useAuth } from "alepha/react/auth";
import { Link, useRouter } from "alepha/react/router";
import { CircleUser, LogIn, LogOut, Shield, User } from "lucide-react";
import type { ReactNode } from "react";

export interface ButtonUserProps {
  /**
   * Custom menu items rendered between the email header and the logout
   * footer. When omitted, a default menu is rendered: email + admin (when
   * permitted) + logout. When provided, the consumer is responsible for the
   * full layout — use `ButtonUser.Email`, `ButtonUser.AdminMenuItem`,
   * `ButtonUser.LogoutMenuItem` as building blocks.
   */
  children?: ReactNode;
  /**
   * Called when the user clicks the sign-in icon (logged-out state). When
   * absent, the icon button is disabled.
   */
  onSignIn?: () => void;
  /**
   * Called when the user clicks the default "Admin Panel" menu item. Has no
   * effect when `children` are provided. When absent, the admin item is
   * hidden even if the user has the permission.
   */
  onAdminClick?: () => void;
  /**
   * Aria-label and tooltip text for the logged-out (sign-in) state.
   * Defaults to `"Sign in"`.
   */
  signInLabel?: string;
  /**
   * Aria-label and tooltip text for the logged-in (account menu) state.
   * Defaults to `"Account menu"`.
   */
  menuLabel?: string;
  /**
   * Visual variant. Defaults to `"ghost"` (minimal). Pass `"outline"` for a
   * bordered toolbar look.
   */
  variant?: "ghost" | "outline";
}

/**
 * Account button: shows a sign-in icon when logged out, a user icon with a
 * dropdown menu when logged in. Reads auth state via `useAuth()`.
 *
 * @example
 * // Default menu
 * <ButtonUser onSignIn={() => router.push("login")} onAdminClick={() => router.push("admin")} />
 *
 * @example
 * // Custom menu
 * <ButtonUser onSignIn={() => router.push("login")}>
 *   <ButtonUser.Email />
 *   <ButtonUser.AdminMenuItem onClick={() => router.push("admin")} />
 *   <DropdownMenuItem onClick={() => router.push("me")}>Profile</DropdownMenuItem>
 *   <DropdownMenuSeparator />
 *   <ButtonUser.LogoutMenuItem />
 * </ButtonUser>
 */
export function ButtonUser(props: ButtonUserProps) {
  const auth = useAuth();

  if (!auth.user) {
    const signInLabel = props.signInLabel ?? "Sign in";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={props.variant ?? "ghost"}
              size="icon"
              aria-label={signInLabel}
              disabled={!props.onSignIn}
              onClick={props.onSignIn}
            />
          }
        >
          <LogIn className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{signInLabel}</TooltipContent>
      </Tooltip>
    );
  }

  const menuLabel = props.menuLabel ?? "Account menu";
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={props.variant ?? "ghost"}
                  size="icon"
                  aria-label={menuLabel}
                />
              }
            />
          }
        >
          <User className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        {props.children ?? <DefaultMenu onAdminClick={props.onAdminClick} />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DefaultMenuProps {
  onAdminClick?: () => void;
}

const DefaultMenu = (props: DefaultMenuProps) => {
  return (
    <>
      <Email />
      {/*
        Account first, admin second: the account page is where every signed-in
        user has something to do, and the admin panel is a destination a
        minority of them can even see. Keep the two in this order everywhere
        the pair is composed (see `AppActions`) so the menu does not reshuffle
        between surfaces.
      */}
      <AccountMenuItem />
      {props.onAdminClick && <AdminMenuItem onClick={props.onAdminClick} />}
      <DropdownMenuSeparator />
      <LogoutMenuItem />
    </>
  );
};

export interface ButtonUserEmailProps {
  /**
   * Optional fallback when the user has no email. Defaults to username, then id.
   */
  fallback?: string;
}

const Email = (props: ButtonUserEmailProps) => {
  const auth = useAuth();
  const user = auth.user as
    | { email?: string; username?: string; id?: string }
    | undefined;
  if (!user) return null;
  const text = user.email ?? user.username ?? props.fallback ?? user.id ?? null;
  if (!text) return null;
  return (
    <div className="text-muted-foreground truncate px-2 py-1.5 text-xs">
      {text}
    </div>
  );
};

export interface ButtonUserAdminMenuItemProps {
  /**
   * Route name to link to. Defaults to `"admin"`, which is what `AdminRouter`
   * registers. Prefer this over {@link onClick}: it is what makes the item a
   * real anchor.
   */
  routeName?: string;

  /**
   * Escape hatch for a destination no route name can express. Supplying it
   * turns the item back into a click handler on a `div`, so the entry loses
   * ⌘-click, middle-click and "open in new tab" — see {@link AccountMenuItem}.
   */
  onClick?: () => void;

  /**
   * Item label. Defaults to `"Admin Panel"`.
   */
  label?: string;
  /**
   * Permission name checked via `useAuth().has(...)`. Defaults to
   * `"admin:ui"`. The item is hidden when the check returns false.
   */
  permission?: string;
}

const AdminMenuItem = (props: ButtonUserAdminMenuItemProps) => {
  const auth = useAuth();
  const router = useRouter<any>();
  const permission = props.permission ?? "admin:ui";
  if (!auth.has(permission)) return null;

  const label = (
    <>
      <Shield className="size-4" />
      {props.label ?? "Admin Panel"}
    </>
  );

  if (props.onClick) {
    return <DropdownMenuItem onClick={props.onClick}>{label}</DropdownMenuItem>;
  }

  const routeName = props.routeName ?? "admin";
  // Same "is the module actually mounted" question `AccountMenuItem` asks. An
  // unregistered name would resolve to a literal `/admin`-shaped string and
  // give the user a link to a 404.
  if (!router.pages?.some((page: any) => page.name === routeName)) return null;

  return (
    <DropdownMenuItem render={<Link href={router.path(routeName)} />}>
      {label}
    </DropdownMenuItem>
  );
};

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
const AccountMenuItem = (props: ButtonUserAccountMenuItemProps) => {
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

export interface ButtonUserLogoutMenuItemProps {
  /**
   * Item label. Defaults to `"Logout"`.
   */
  label?: string;
}

const LogoutMenuItem = (props: ButtonUserLogoutMenuItemProps) => {
  const auth = useAuth();
  return (
    <DropdownMenuItem onClick={() => auth.logout()}>
      <LogOut className="size-4" />
      {props.label ?? "Logout"}
    </DropdownMenuItem>
  );
};

ButtonUser.Email = Email;
ButtonUser.AdminMenuItem = AdminMenuItem;
ButtonUser.AccountMenuItem = AccountMenuItem;
ButtonUser.LogoutMenuItem = LogoutMenuItem;
