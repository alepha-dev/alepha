/**
 * Application shells and their chrome.
 *
 * `$pageNav` declares a page that appears in a shell's sidebar, for an app
 * that hangs its pages off its OWN layout rather than the admin shell's
 * (`$pageAdmin` is the same thing already parented to `AdminRouter`).
 *
 * `AppShell` is the sidebar-and-header frame of an application and `NavShell`
 * the page-tree variant with its `Spotlight` search. `PlateLayout` and
 * `DetailLayout` frame a page, `AppActions` a toolbar. `ButtonDark`,
 * `ButtonTheme`, `ButtonLanguage`, `ButtonInbox` and `ButtonUser` are the
 * header buttons, and `ActionErrorToaster` turns a failed action into a toast.
 *
 * @module alepha.ui.shell
 */

export {
  ActionErrorToaster,
  type ActionErrorToasterProps,
} from "./ActionErrorToaster.tsx";
export { $pageNav, type PageNavOptions } from "./$pageNav.tsx";
export { AppActions, type AppActionsProps } from "./AppActions.tsx";
export {
  AppShell,
  type AppShellProps,
  type NavigationProgressOptions,
} from "./AppShell.tsx";
export type { NavGroup, NavItem } from "./appShellNav.tsx";
export { ButtonDark, type ButtonDarkProps } from "./ButtonDark.tsx";
export { ButtonInbox, type ButtonInboxProps } from "./ButtonInbox.tsx";
export { ButtonLanguage, type ButtonLanguageProps } from "./ButtonLanguage.tsx";
export { ButtonTheme, type ButtonThemeProps } from "./ButtonTheme.tsx";
export { ButtonUser, type ButtonUserProps } from "./ButtonUser.tsx";
export type { ButtonUserAccountMenuItemProps } from "./ButtonUserAccountMenuItem.tsx";
export type { ButtonUserAdminMenuItemProps } from "./ButtonUserAdminMenuItem.tsx";
export type { ButtonUserEmailProps } from "./ButtonUserEmail.tsx";
export type { ButtonUserLogoutMenuItemProps } from "./ButtonUserLogoutMenuItem.tsx";
export {
  DetailAside,
  type DetailAsideProps,
  type DetailAsideRow,
} from "./DetailAside.tsx";
export {
  DetailLayout,
  type DetailLayoutProps,
  type DetailNotFound,
  type DetailTab,
} from "./DetailLayout.tsx";
export { inboxUnreadAtom } from "./inboxUnreadAtom.ts";
export {
  NavigationProgress,
  type NavigationProgressProps,
} from "./NavigationProgress.tsx";
export { NavShell, type NavShellProps } from "./NavShell.tsx";
export { PlateLayout, type PlateLayoutProps } from "./PlateLayout.tsx";
export type { PlateTab } from "./PlateTabBar.tsx";
export { SidebarNavAutoClose } from "./SidebarNavAutoClose.tsx";
export { Spotlight, type SpotlightProps } from "./Spotlight.tsx";
export { useDetailTab } from "./useDetailTab.tsx";
