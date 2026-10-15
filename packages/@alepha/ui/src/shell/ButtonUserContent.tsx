import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { LogIn, User } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import { UserAvatar } from "../core/UserAvatar.tsx";
import type { ButtonUserProps } from "./ButtonUser.tsx";
import { ButtonUserDefaultMenu } from "./ButtonUserDefaultMenu.tsx";

/**
 * The account button itself. See {@link ButtonUserProps}.
 */
export type ButtonUserContentProps = ButtonUserProps;

/**
 * What `ButtonUser` renders once it may read the visitor: the sign-in icon
 * when logged out, the avatar and its menu when logged in. Wrapped in
 * `<Personal>` by `ButtonUser`, so a page showing it stays shareable.
 */
export const ButtonUserContent = (props: ButtonUserContentProps) => {
  const auth = useAuth();

  if (!auth.user) {
    const signInLabel = props.signInLabel ?? "Sign in";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={props.variant ?? "minimal"}
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
  const face =
    props.avatar ??
    (auth.user.picture ? (
      <UserAvatar fileId={auth.user.picture} className="size-7" />
    ) : (
      <User className="size-4" />
    ));
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={props.variant ?? "minimal"}
                  size="icon"
                  aria-label={menuLabel}
                />
              }
            />
          }
        >
          {/* The tooltip and `aria-label` are untouched by the avatar: a
              face is not a label, and "Account menu" is still the accessible
              name of the button. */}
          {face}
        </TooltipTrigger>
        <TooltipContent>{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        {props.children ?? (
          <ButtonUserDefaultMenu onAdminClick={props.onAdminClick} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
