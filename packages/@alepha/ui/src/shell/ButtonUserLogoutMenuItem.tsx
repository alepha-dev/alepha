import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { LogOut } from "lucide-react";

import { DropdownMenuItem } from "../core/DropdownMenu.tsx";

export interface ButtonUserLogoutMenuItemProps {
  /**
   * Item label. Defaults to `"Logout"`.
   */
  label?: string;
}

export const ButtonUserLogoutMenuItem = (
  props: ButtonUserLogoutMenuItemProps,
) => {
  const auth = useAuth();
  return (
    <DropdownMenuItem onClick={() => auth.logout()}>
      <LogOut className="size-4" />
      {props.label ?? "Logout"}
    </DropdownMenuItem>
  );
};
