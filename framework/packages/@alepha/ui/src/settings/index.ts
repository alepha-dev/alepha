/**
 * The settings kit.
 *
 * `$settingsDialog` declares a settings dialog, opened over the current page
 * and held in state, never in the URL; `$settingsSection` adds a section to it
 * from any class, and `useSettingsDialog` opens and closes it.
 *
 * `SettingsDialog` draws a declared dialog, and `DialogProvider` draws it for
 * you. `SettingsSection`, `SettingsRow`, `SettingsHeading` and
 * `SettingsDangerSection` build a section's content, and `settingsCardEdge`
 * is the one card edge they all share.
 *
 * @module alepha.ui.settings
 */

export { $settingsDialog } from "./$settingsDialog.ts";
export { $settingsSection } from "./$settingsSection.ts";
export {
  type SettingsDialogOptions,
  SettingsDialogPrimitive,
  SettingsDialogs,
  settingsDialogsAtom,
  type SettingsSectionGroup,
  type SettingsSectionOptions,
  SettingsSectionPrimitive,
} from "./SettingsDialogs.ts";
export {
  useSettingsDialog,
  type UseSettingsDialogReturn,
} from "./useSettingsDialog.ts";

export { settingsCardEdge } from "./settingsCardEdge.ts";
export {
  SettingsDangerSection,
  type SettingsDangerSectionProps,
} from "./SettingsDangerSection.tsx";
export {
  SettingsHeading,
  type SettingsHeadingProps,
} from "./SettingsHeading.tsx";
export { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog.tsx";
export { SettingsRow, type SettingsRowProps } from "./SettingsRow.tsx";
export {
  SettingsSection,
  type SettingsSectionProps,
} from "./SettingsSection.tsx";
