import * as React from "react";

void React;

import { DropdownMenuSeparator } from "../core/DropdownMenu.tsx";
import { ButtonUserAccountMenuItem } from "./ButtonUserAccountMenuItem.tsx";
import { ButtonUserAdminMenuItem } from "./ButtonUserAdminMenuItem.tsx";
import { ButtonUserEmail } from "./ButtonUserEmail.tsx";
import { ButtonUserLogoutMenuItem } from "./ButtonUserLogoutMenuItem.tsx";

export interface ButtonUserDefaultMenuProps {
  onAdminClick?: () => void;
}

export const ButtonUserDefaultMenu = (props: ButtonUserDefaultMenuProps) => {
  return (
    <>
      <ButtonUserEmail />
      {/*
        Account first, admin second: the account page is where every signed-in
        user has something to do, and the admin panel is a destination a
        minority of them can even see. Keep the two in this order everywhere
        the pair is composed (see `AppActions`) so the menu does not reshuffle
        between surfaces.
      */}
      <ButtonUserAccountMenuItem />
      {props.onAdminClick && (
        <ButtonUserAdminMenuItem onClick={props.onAdminClick} />
      )}
      <DropdownMenuSeparator />
      <ButtonUserLogoutMenuItem />
    </>
  );
};
