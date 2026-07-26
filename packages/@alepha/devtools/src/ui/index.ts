import { $module } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AppRouter } from "./AppRouter.tsx";
import { devAuthAtom } from "./atoms/devAuthAtom.ts";
import { devMetadataAtom } from "./atoms/devMetadataAtom.ts";

/**
 * The devtools browser application.
 *
 * `AlephaReactI18n` is a hard requirement, not a convenience: the layout mounts
 * `DialogProvider` from `@alepha/ui`, which calls `useI18n()`. Without the
 * module registered that injection lands after the container locks and throws
 * `ContainerLockedError`, which the router's error boundary renders as a blank
 * "Something went wrong" — the whole UI, not just the dialog.
 */
export const DevToolsApp = $module({
  name: "alepha.devtools.ui",
  imports: [AlephaReactI18n],
  services: [AppRouter],
  atoms: [devMetadataAtom, devAuthAtom],
});
