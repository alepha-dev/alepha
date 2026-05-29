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
import { LogIn, LogOut, Shield, User } from "lucide-react";
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
   * Called when the item is clicked.
   */
  onClick: () => void;
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
  const permission = props.permission ?? "admin:ui";
  if (!auth.has(permission)) return null;
  return (
    <DropdownMenuItem onClick={props.onClick}>
      <Shield className="size-4" />
      {props.label ?? "Admin Panel"}
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
ButtonUser.LogoutMenuItem = LogoutMenuItem;
