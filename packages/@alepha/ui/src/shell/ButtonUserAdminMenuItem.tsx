import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { Link, useRouter } from "alepha/react/router";
import { Shield } from "lucide-react";

import { DropdownMenuItem } from "../core/DropdownMenu.tsx";

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
   * ⌘-click, middle-click and "open in new tab" — see
   * `ButtonUserAccountMenuItem.tsx`.
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

export const ButtonUserAdminMenuItem = (
  props: ButtonUserAdminMenuItemProps,
) => {
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
  // Same "is the module actually mounted" question `ButtonUserAccountMenuItem`
  // asks. An unregistered name would resolve to a literal `/admin`-shaped
  // string and give the user a link to a 404.
  if (!router.pages?.some((page: any) => page.name === routeName)) return null;

  return (
    <DropdownMenuItem render={<Link href={router.path(routeName)} />}>
      {label}
    </DropdownMenuItem>
  );
};
