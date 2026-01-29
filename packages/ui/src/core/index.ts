import { $module, type Static } from "alepha";
import { AlephaReactForm } from "alepha/react/form";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ComponentType, ReactNode } from "react";
import { alephaThemeAtom } from "./atoms/alephaThemeAtom.ts";
import type { ControlProps } from "./components/form/Control.tsx";
import { ThemeProvider } from "./providers/ThemeProvider.ts";
import { RootRouter } from "./RootRouter.ts";
import { DialogService } from "./services/DialogService.tsx";
import { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export { Flex, Text } from "@mantine/core";
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
export { default as ActionButton } from "./components/buttons/ActionButton.tsx";
export { default as BurgerButton } from "./components/buttons/BurgerButton.tsx";
export type { ClipboardButtonProps } from "./components/buttons/ClipboardButton.tsx";
export { default as ClipboardButton } from "./components/buttons/ClipboardButton.tsx";
export { default as DarkModeButton } from "./components/buttons/DarkModeButton.tsx";
export { default as LanguageButton } from "./components/buttons/LanguageButton.tsx";
export { default as OmnibarButton } from "./components/buttons/OmnibarButton.tsx";
export type { ThemeButtonProps } from "./components/buttons/ThemeButton.tsx";
export { default as ThemeButton } from "./components/buttons/ThemeButton.tsx";
export { default as AlertDialog } from "./components/dialogs/AlertDialog.tsx";
export { default as ConfirmDialog } from "./components/dialogs/ConfirmDialog.tsx";
export { default as PromptDialog } from "./components/dialogs/PromptDialog.tsx";
export { default as Control } from "./components/form/Control.tsx";
export { default as ControlArray } from "./components/form/ControlArray.tsx";
export { default as ControlDate } from "./components/form/ControlDate.tsx";
export { default as ControlNumber } from "./components/form/ControlNumber.tsx";
export { default as ControlObject } from "./components/form/ControlObject.tsx";
export { default as ControlQueryBuilder } from "./components/form/ControlQueryBuilder.tsx";
export { default as ControlSelect } from "./components/form/ControlSelect.tsx";
export { default as TypeForm } from "./components/form/TypeForm.tsx";
export {
  type AdminShellProps,
  default as AdminShell,
} from "./components/layout/AdminShell.tsx";
export { default as AlephaMantineProvider } from "./components/layout/AlephaMantineProvider.tsx";
export type {
  AppBarBurger,
  AppBarDark,
  AppBarDivider,
  AppBarElement,
  AppBarItem,
  AppBarLang,
  AppBarProps,
  AppBarSearch,
  AppBarSpacer,
} from "./components/layout/AppBar.tsx";
export { default as AppBar } from "./components/layout/AppBar.tsx";
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
export { useDialog } from "./hooks/useDialog.ts";
export { useToast } from "./hooks/useToast.ts";
export * from "./providers/ThemeProvider.ts";
export * from "./RootRouter.ts";
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
 * | type | quality | stability |
 * |------|---------|-----------|
 * | frontend | rare | experimental |
 *
 * Core UI components based on Mantine UI v8.
 *
 * **Features:**
 * - Mantine integration with theme support
 * - ActionButton, BurgerButton, ClipboardButton, DarkModeButton, LanguageButton, ThemeButton
 * - AlertDialog, ConfirmDialog, PromptDialog
 * - Form controls: Control, ControlArray, ControlDate, ControlNumber, ControlObject, ControlSelect, ControlQueryBuilder
 * - TypeForm for automatic form generation from TypeBox schemas
 * - AdminShell layout component
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
  services: [DialogService, ToastService, ThemeProvider, RootRouter],
  register: (alepha) => {
    alepha.with(AlephaReactI18n);
    alepha.with(AlephaReactHead);
    alepha.with(AlephaReactForm);
    alepha.with(ThemeProvider);
    alepha.with(DialogService);
    alepha.with(ToastService);
  },
});
