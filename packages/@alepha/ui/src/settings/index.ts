/**
 * The settings kit.
 *
 * `SettingsLayout` and `SettingsNav` frame a settings area; `SettingsSection`,
 * `SettingsRow`, `SettingsHeading` and `SettingsDangerSection` build its pages,
 * and `settingsCardEdge` is the one card edge they all share.
 *
 * @module alepha.ui.settings
 */

export { settingsCardEdge } from "./settingsCardEdge.ts";
export {
  SettingsDangerSection,
  type SettingsDangerSectionProps,
} from "./SettingsDangerSection.tsx";
export {
  SettingsHeading,
  type SettingsHeadingProps,
} from "./SettingsHeading.tsx";
export { SettingsLayout, type SettingsLayoutProps } from "./SettingsLayout.tsx";
export {
  SettingsNav,
  type SettingsNavItem,
  type SettingsNavProps,
} from "./SettingsNav.tsx";
export { SettingsRow, type SettingsRowProps } from "./SettingsRow.tsx";
export {
  SettingsSection,
  type SettingsSectionProps,
} from "./SettingsSection.tsx";
