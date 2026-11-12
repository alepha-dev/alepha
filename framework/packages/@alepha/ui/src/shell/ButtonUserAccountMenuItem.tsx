import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { CircleUser } from "lucide-react";

import { DropdownMenuItem } from "../core/DropdownMenu.tsx";
import { useSettingsDialog } from "../settings/useSettingsDialog.ts";

export interface ButtonUserAccountMenuItemProps {
  /**
   * Escape hatch for a destination the account dialog does not cover.
   * Supplying it replaces opening the dialog, and shows the item whether or
   * not the dialog has anything to show.
   */
  onClick?: () => void;

  /**
   * Item label. Defaults to `"User Account"`.
   */
  label?: string;
}

/**
 * Opens the signed-in user's account dialog (`AccountDialog`, the settings
 * dialog named `account`) over the current page.
 *
 * **It hides itself when the dialog has no visible section**: an application
 * that never registers `AccountDialog`, or whose every section is hidden,
 * gets no dead entry. The same question the sections' own `can` gates
 * answer, asked once for all of them.
 *
 * A click handler, not a link: the dialog is state, not a destination, and
 * has no URL to open in a new tab. A link made outside the app reaches it
 * with `?account=<section>` instead.
 */
export const ButtonUserAccountMenuItem = (
  props: ButtonUserAccountMenuItemProps,
) => {
  const auth = useAuth();
  const account = useSettingsDialog("account");

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

  // No account dialog, or nothing in it → no entry.
  if (account.sections.length === 0) {
    return null;
  }

  return (
    <DropdownMenuItem onClick={() => account.open()}>{label}</DropdownMenuItem>
  );
};
