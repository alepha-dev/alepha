/**
 * Application shells and their chrome.
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
export { AppActions, type AppActionsProps } from "./AppActions.tsx";
export {
  AppShell,
  type AppShellProps,
  type NavGroup,
  type NavigationProgressOptions,
  type NavItem,
  SidebarNavAutoClose,
} from "./AppShell.tsx";
export { ButtonDark, type ButtonDarkProps } from "./ButtonDark.tsx";
export { ButtonInbox, type ButtonInboxProps } from "./ButtonInbox.tsx";
export { ButtonLanguage, type ButtonLanguageProps } from "./ButtonLanguage.tsx";
export { ButtonTheme, type ButtonThemeProps } from "./ButtonTheme.tsx";
export {
  ButtonUser,
  type ButtonUserAccountMenuItemProps,
  type ButtonUserAdminMenuItemProps,
  type ButtonUserEmailProps,
  type ButtonUserLogoutMenuItemProps,
  type ButtonUserProps,
} from "./ButtonUser.tsx";
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
export { NavigationProgress } from "./NavigationProgress.tsx";
export { NavShell, type NavShellProps } from "./NavShell.tsx";
export { PlateLayout, type PlateLayoutProps } from "./PlateLayout.tsx";
export type { PlateTab } from "./PlateTabBar.tsx";
export { Spotlight, type SpotlightProps } from "./Spotlight.tsx";
export { useDetailTab } from "./useDetailTab.tsx";
