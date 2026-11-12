import * as React from "react";

void React;

import { AlephaContext } from "alepha/react";
import { useContext, useSyncExternalStore } from "react";

import { SettingsDialog } from "./SettingsDialog.tsx";
import { settingsDialogsAtom } from "./SettingsDialogs.ts";

/**
 * Draws the settings dialog that is open, if any. Mounted by
 * `DialogProvider`, so every shell that has one (AppShell, the admin shell, a
 * hand-built layout) shows every registered settings dialog with nothing to
 * add per shell.
 *
 * Reads the open state from the store directly rather than through
 * `useSettingsDialog`: it has to cost nothing in an application that declares
 * no dialog, and to stay inert under a `DialogProvider` rendered without an
 * `AlephaContext` (a component spec), where a hook that requires one throws.
 */
export const SettingsDialogHost = () => {
  const alepha = useContext(AlephaContext);
  const open = useSyncExternalStore(
    (onChange) =>
      alepha?.isBrowser()
        ? alepha.events.on("state:mutated", (ev) => {
            if (ev.key === settingsDialogsAtom.key) onChange();
          })
        : () => {},
    () => alepha?.store.get(settingsDialogsAtom)?.open,
    () => undefined,
  );
  // Kept mounted after the first open, so the close animation plays and the
  // last section's chunk stays warm for the next open.
  const [last, setLast] = React.useState<string | undefined>(undefined);
  if (open && open !== last) {
    setLast(open);
  }
  const name = open ?? last;
  if (!alepha || !name) {
    return null;
  }
  return <SettingsDialog name={name} />;
};
