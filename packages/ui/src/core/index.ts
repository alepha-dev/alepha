import { $module, type Static } from "alepha";
import { AlephaReactForm } from "alepha/react/form";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ComponentType, ReactNode } from "react";
import { alephaSidebarAtom } from "./atoms/alephaSidebarAtom.ts";
import { alephaThemeAtom } from "./atoms/alephaThemeAtom.ts";
import { alephaThemeOverridesAtom } from "./atoms/alephaThemeOverridesAtom.ts";
import { ThemeProvider } from "./providers/ThemeProvider.ts";
import { DialogService } from "./services/DialogService.tsx";
import { ToastService } from "./services/ToastService.tsx";
import { UiRouter } from "./UiRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/alephaSidebarAtom.ts";
export * from "./atoms/alephaThemeAtom.ts";
export * from "./atoms/alephaThemeListAtom.ts";
export * from "./atoms/alephaThemeOverridesAtom.ts";
export * from "./atoms/themes/default.ts";
export * from "./atoms/themes/midnight.ts";
export type { AlephaMantineProviderProps } from "./components/AlephaMantineProvider.tsx";
export { default as AlephaMantineProvider } from "./components/AlephaMantineProvider.tsx";
export type {
  ActionClickButtonProps,
  ActionCommonProps,
  ActionMenuConfig,
  ActionMenuItem,
  ActionNavigationButtonProps,
  ActionProps,
  ActionSubmitButtonProps,
} from "./components/buttons/ActionButton.tsx";
export { default as ActionButton } from "./components/buttons/ActionButton.tsx";
export { default as BurgerButton } from "./components/buttons/BurgerButton.tsx";
export type { ClipboardButtonProps } from "./components/buttons/ClipboardButton.tsx";
export { default as ClipboardButton } from "./components/buttons/ClipboardButton.tsx";
export { default as DarkModeButton } from "./components/buttons/DarkModeButton.tsx";
export { default as LanguageButton } from "./components/buttons/LanguageButton.tsx";
export type { OmnibarButtonProps } from "./components/buttons/OmnibarButton.tsx";
export { default as OmnibarButton } from "./components/buttons/OmnibarButton.tsx";
export { default as ThemeButton } from "./components/buttons/ThemeButton.tsx";
export { default as SidebarCollapseButton } from "./components/buttons/ToggleSidebarButton.tsx";
export type {
  DetailDrawerProps,
  DetailDrawerStatus,
  DetailDrawerTab,
} from "./components/data/DetailDrawer.tsx";
export { default as DetailDrawer } from "./components/data/DetailDrawer.tsx";
export type {
  DetailListItem,
  DetailListProps,
} from "./components/data/DetailList.tsx";
export { default as DetailList } from "./components/data/DetailList.tsx";
export type {
  StatCardItem,
  StatCardsProps,
} from "./components/data/StatCards.tsx";
export { default as StatCards } from "./components/data/StatCards.tsx";
export { default as AlertDialog } from "./components/dialogs/AlertDialog.tsx";
export { default as ConfirmDialog } from "./components/dialogs/ConfirmDialog.tsx";
export { default as PromptDialog } from "./components/dialogs/PromptDialog.tsx";
export type { FlexProps } from "./components/Flex.tsx";
export { default as Flex } from "./components/Flex.tsx";
export { default as Heading } from "./components/Heading.tsx";
export type {
  AppBarBack,
  AppBarBurger,
  AppBarDark,
  AppBarDivider,
  AppBarElement,
  AppBarItem,
  AppBarLang,
  AppBarLogo,
  AppBarProps,
  AppBarSearch,
  AppBarSpacer,
} from "./components/layout/AppBar.tsx";
export { default as AppBar } from "./components/layout/AppBar.tsx";
export type { BreadcrumbProps } from "./components/layout/Breadcrumb.tsx";
export { default as Breadcrumbs } from "./components/layout/Breadcrumb.tsx";
export type { ContainerProps } from "./components/layout/Container.tsx";
export { default as Container } from "./components/layout/Container.tsx";
export {
  type DashboardShellProps,
  type DashboardShellProps as AdminShellProps,
  default as DashboardShell,
  default as AdminShell,
} from "./components/layout/DashboardShell.tsx";
export type { OmnibarProps } from "./components/layout/Omnibar.tsx";
export { default as Omnibar } from "./components/layout/Omnibar.tsx";
export type {
  SidebarAbstractItem,
  SidebarButtonTheme,
  SidebarDivider,
  SidebarElement,
  SidebarItemProps,
  SidebarMenuItem,
  SidebarNode,
  SidebarProps,
  SidebarSearch,
  SidebarSection,
  SidebarSpacer,
  SidebarTheme,
} from "./components/layout/Sidebar.tsx";
export { Sidebar } from "./components/layout/Sidebar.tsx";
export type { TextProps } from "./components/Text.tsx";
export { default as Text } from "./components/Text.tsx";
export * from "./constants/ui.ts";
// Form
export * from "./form/index.ts";
export * from "./helpers/isComponentType.ts";
export * from "./helpers/renderIcon.tsx";
export { useDialog } from "./hooks/useDialog.ts";
export { type ThemeExpert, useTheme } from "./hooks/useTheme.ts";
export { useToast } from "./hooks/useToast.ts";
export * from "./interfaces/AlephaIntent.ts";
// JSON
export * from "./json/index.ts";
export * from "./primitives/$ui.ts";
export * from "./providers/ThemeProvider.ts";
export type {
  AlertDialogOptions,
  AlertDialogProps,
  BaseDialogOptions,
  ConfirmDialogOptions,
  ConfirmDialogProps,
  PromptDialogOptions,
  PromptDialogProps,
} from "./services/DialogService.tsx";
export { DialogService } from "./services/DialogService.tsx";
export { ToastService } from "./services/ToastService.tsx";
// Table
export * from "./table/index.ts";
export * from "./UiRouter.ts";
export * from "./utils/extractSchemaFields.ts";
export * from "./utils/icons.tsx";
export * from "./utils/string.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    [alephaSidebarAtom.key]?: Static<typeof alephaSidebarAtom.schema>;
    [alephaThemeAtom.key]?: Static<typeof alephaThemeAtom.schema>;
    [alephaThemeOverridesAtom.key]?: Static<
      typeof alephaThemeOverridesAtom.schema
    >;
  }
}

declare module "alepha/react/router" {
  interface PagePrimitiveOptions {
    /**
     * Human-readable title for the page.
     * - for Sidebar navigation
     * - for Omnibar navigation
     * (soon)
     * - for Breadcrumbs
     * - for document title (with AlephaReactHead)
     */
    label?: string;

    /**
     * Optional description of the page.
     */
    description?: string;

    /**
     * Optional icon for the page.
     */
    icon?: ReactNode | ComponentType;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Core UI components based on Mantine UI v8.
 *
 * **Features:**
 * - Mantine integration with theme support
 * - ActionButton, BurgerButton, ClipboardButton, DarkModeButton, LanguageButton, ThemeButton
 * - AlertDialog, ConfirmDialog, PromptDialog
 * - Form controls: Control, ControlArray, ControlDate, ControlNumber, ControlObject, ControlSelect, ControlQueryBuilder
 * - TypeForm for automatic form generation from TypeBox schemas
 * - DashboardShell layout component
 * - AppBar with configurable elements
 * - Sidebar navigation with sections and menu items
 * - Omnibar for command palette / search
 * - DataTable with filtering, sorting, pagination
 * - Toast notifications
 * - Theme system with dark mode
 *
 * @module alepha.ui
 */
export const AlephaUI = $module({
  name: "alepha.ui",
  services: [DialogService, ToastService, ThemeProvider, UiRouter],
  register: (alepha) => {
    alepha.with(AlephaReactI18n);
    alepha.with(AlephaReactHead);
    alepha.with(AlephaReactForm);
    alepha.with(ThemeProvider);
    alepha.with(DialogService);
    alepha.with(ToastService);
  },
});
