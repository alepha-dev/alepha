import { useInject, useStore } from "alepha/react";
import { currentUserAtom } from "alepha/security";
import { useMemo } from "react";

import {
  type SettingsDialogPrimitive,
  SettingsDialogs,
  type SettingsSectionGroup,
  type SettingsSectionPrimitive,
  settingsDialogsAtom,
} from "./SettingsDialogs.ts";

export interface UseSettingsDialogReturn {
  /**
   * The dialog, `undefined` when no `$settingsDialog` has this name.
   */
  dialog?: SettingsDialogPrimitive;
  /**
   * Whether this dialog is the one on screen.
   */
  isOpen: boolean;
  /**
   * The section on screen, while open.
   */
  section?: string;
  /**
   * The visible sections, by nav group.
   */
  groups: SettingsSectionGroup[];
  /**
   * The visible sections, in nav order. Empty means the dialog has nothing to
   * show, and an entry point opening it should hide itself.
   */
  sections: SettingsSectionPrimitive[];
  /**
   * Open the dialog, on `section`, or on the last one viewed, or on the first.
   */
  open: (section?: string) => void;
  close: () => void;
}

/**
 * A settings dialog's state and the way to open and close it.
 *
 * ```tsx
 * const account = useSettingsDialog("account");
 * if (account.sections.length === 0) return null;
 * return <Button onClick={() => account.open("sessions")}>Sessions</Button>;
 * ```
 */
export const useSettingsDialog = (name: string): UseSettingsDialogReturn => {
  const dialogs = useInject(SettingsDialogs);
  const [state] = useStore(settingsDialogsAtom);
  // Which sections are visible follows the user (a `can` reads the actions
  // the session may call), so a sign-in re-reads them.
  const [user] = useStore(currentUserAtom);
  const isOpen = state?.open === name;
  const groups = useMemo(() => dialogs.groups(name), [dialogs, name, user]);

  return {
    dialog: dialogs.dialog(name),
    isOpen,
    section: isOpen ? state?.section : undefined,
    groups,
    sections: groups.flatMap((group) => group.sections),
    open: (section) => dialogs.open(name, section),
    close: () => dialogs.close(name),
  };
};
