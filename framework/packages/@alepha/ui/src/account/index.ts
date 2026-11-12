/**
 * The signed-in user's own account, as a settings dialog over the page.
 *
 * `AccountDialog` declares the `account` dialog and its five sections
 * (profile, security, sessions, API keys, connected apps), each its own lazy
 * chunk fetching its own data. The section components are exported by name
 * too. An application adds a section with `$settingsSection` against
 * `AccountDialog.dialog`.
 *
 * The profile page ends with `AccountDisplay`, the viewer's own display
 * settings: the colour-blind switch, which a signed-in viewer finds here and
 * not in the account menu.
 *
 * @module alepha.ui.account
 */

export {
  default as AccountConnections,
  type AccountConnectionsProps,
} from "./AccountConnections.tsx";
export {
  default as AccountKeys,
  type AccountKeysProps,
} from "./AccountKeys.tsx";
export { AccountDialog } from "./AccountDialog.ts";
export {
  type AccountDialogOptions,
  accountDialogOptionsAtom,
  type AccountSectionName,
} from "./AccountDialogOptions.ts";
export { AccountPage, type AccountPageProps } from "./AccountPage.tsx";
export { AccountDisplay } from "./AccountDisplay.tsx";
export {
  default as AccountProfile,
  type AccountProfileProps,
} from "./AccountProfile.tsx";
export {
  AccountPasskeyProofDialog,
  type AccountPasskeyProofDialogProps,
} from "./AccountPasskeyProofDialog.tsx";
export {
  AccountPasskeyRow,
  type AccountPasskeyRowProps,
} from "./AccountPasskeyRow.tsx";
export {
  AccountPasskeys,
  type AccountPasskeysProps,
} from "./AccountPasskeys.tsx";
export {
  default as AccountSecurity,
  type AccountSecurityProps,
} from "./AccountSecurity.tsx";
export {
  default as AccountSessions,
  type AccountSessionsProps,
} from "./AccountSessions.tsx";
