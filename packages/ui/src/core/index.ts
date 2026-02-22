import { $context, $module, type Static } from "alepha";
import { AlephaReactForm } from "alepha/react/form";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ComponentType, ReactNode } from "react";
import { alephaSidebarAtom } from "./atoms/alephaSidebarAtom.ts";
import { alephaThemeAtom } from "./atoms/alephaThemeAtom.ts";
import {
  type AlephaThemeListAtom,
  alephaThemeListAtom,
} from "./atoms/alephaThemeListAtom.ts";
import type { ControlProps } from "./components/form/Control.tsx";
import { ThemeProvider } from "./providers/ThemeProvider.ts";
import { DialogService } from "./services/DialogService.tsx";
import { ToastService } from "./services/ToastService.tsx";
import { UiRouter } from "./UiRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

// Layout components — re-exported from @alepha/ui/layout for backward compat
export {
  AdminShell,
  type AdminShellProps,
  AlephaMantineProvider,
  AppBar,
  type AppBarBurger,
  type AppBarDark,
  type AppBarDivider,
  type AppBarElement,
  type AppBarItem,
  type AppBarLang,
  type AppBarProps,
  type AppBarSearch,
  type AppBarSpacer,
  type BreadcrumbProps,
  Breadcrumbs,
  DashboardShell,
  type DashboardShellProps,
  Omnibar,
  Sidebar,
  type SidebarAbstractItem,
  type SidebarButtonTheme,
  type SidebarDivider,
  type SidebarElement,
  type SidebarItemProps,
  type SidebarMenuItem,
  type SidebarNode,
  type SidebarProps,
  type SidebarSearch,
  type SidebarSection,
  type SidebarSpacer,
  type SidebarTheme,
} from "@alepha/ui/layout";
export * from "./atoms/alephaSidebarAtom.ts";
export * from "./atoms/alephaThemeAtom.ts";
export * from "./atoms/alephaThemeListAtom.ts";
export * from "./atoms/themes/default.ts";
export * from "./atoms/themes/midnight.ts";
export type {
  ActionClickButtonProps,
  ActionCommonProps,
  ActionMenuConfig,
  ActionMenuItem,
  ActionNavigationButtonProps,
  ActionProps,
  ActionSubmitButtonProps,
} from "./components/buttons/ActionButton.tsx";
export {
  default as ActionButton,
  default as Button,
} from "./components/buttons/ActionButton.tsx";
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
export { default as Control } from "./components/form/Control.tsx";
export { default as ControlArray } from "./components/form/ControlArray.tsx";
export { default as ControlDate } from "./components/form/ControlDate.tsx";
export { default as ControlNumber } from "./components/form/ControlNumber.tsx";
export { default as ControlObject } from "./components/form/ControlObject.tsx";
export { default as ControlQueryBuilder } from "./components/form/ControlQueryBuilder.tsx";
export { default as ControlSelect } from "./components/form/ControlSelect.tsx";
export { default as TypeForm } from "./components/form/TypeForm.tsx";
export { default as Heading } from "./components/Heading.tsx";
export type { TextProps } from "./components/Text.tsx";
export { default as Text } from "./components/Text.tsx";
export { default as DataTable } from "./components/table/DataTable.tsx";
export type {
  CheckboxAction,
  CheckboxActionContext,
  ColumnVisibility,
  DataTableColumn,
  DataTableColumnContext,
  DataTableProps,
  DataTableSubmitContext,
  FilterVisibility,
  MaybePage,
} from "./components/table/types.ts";
export * from "./constants/ui.ts";
export * from "./helpers/isComponentType.ts";
export * from "./helpers/renderIcon.tsx";
export { useDialog } from "./hooks/useDialog.ts";
export { useTheme } from "./hooks/useTheme.ts";
export { useToast } from "./hooks/useToast.ts";
export * from "./interfaces/AlephaIntent.ts";
export * from "./providers/ThemeProvider.ts";
export type {
  AlertDialogOptions,
  AlertDialogProps,
  BaseDialogOptions,
  ConfirmDialogOptions,
  ConfirmDialogProps,
  FormDialogOptions,
  PromptDialogOptions,
  PromptDialogProps,
} from "./services/DialogService.tsx";
export { DialogService } from "./services/DialogService.tsx";
export { ToastService } from "./services/ToastService.tsx";
export * from "./UiRouter.ts";
export * from "./utils/extractSchemaFields.ts";
export * from "./utils/icons.tsx";
export * from "./utils/string.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "typebox" {
  interface TSchemaOptions {
    $control?: Omit<ControlProps, "input">;
  }
}

declare module "alepha" {
  interface State {
    [alephaSidebarAtom.key]?: Static<typeof alephaSidebarAtom.schema>;
    [alephaThemeAtom.key]?: Static<typeof alephaThemeAtom.schema>;
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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 2 - beta | 0.12.0 | node, bun, workerd, browser|
 *
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

/**
 * Convenience function to configure and inject the UiRouter.
 */
export const $ui = (options: { themes?: AlephaThemeListAtom } = {}) => {
  const { alepha } = $context();
  if (options.themes) {
    alepha.store.set(alephaThemeListAtom, options.themes);
  }
  return alepha.inject(UiRouter); // Inject as singleton ?
};
