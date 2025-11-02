import { $module } from "@alepha/core";
import { AlephaReactForm } from "@alepha/react-form";
import { AlephaReactHead } from "@alepha/react-head";
import { AlephaReactI18n } from "@alepha/react-i18n";
import type { ControlProps } from "./components/form/Control.tsx";
import { RootRouter } from "./RootRouter.ts";
import { DialogService } from "./services/DialogService.tsx";
import { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export { Flex } from "@mantine/core";
export type {
  ActionClickButtonProps,
  ActionCommonProps,
  ActionMenuConfig,
  ActionMenuItem,
  ActionNavigationButtonProps,
  ActionProps,
  ActionSubmitButtonProps,
} from "./components/buttons/ActionButton.tsx";
export { default as Action } from "./components/buttons/ActionButton.tsx";
export { default as DarkModeButton } from "./components/buttons/DarkModeButton.tsx";
export { default as OmnibarButton } from "./components/buttons/OmnibarButton.tsx";
export { default as AlertDialog } from "./components/dialogs/AlertDialog.tsx";
export { default as ConfirmDialog } from "./components/dialogs/ConfirmDialog.tsx";
export { default as PromptDialog } from "./components/dialogs/PromptDialog.tsx";
export { default as Control } from "./components/form/Control.tsx";
export { default as ControlDate } from "./components/form/ControlDate.tsx";
export { default as ControlSelect } from "./components/form/ControlSelect.tsx";
export { default as TypeForm } from "./components/form/TypeForm.tsx";
export { default as AdminShell } from "./components/layout/AdminShell.tsx";
export { default as AlephaMantineProvider } from "./components/layout/AlephaMantineProvider.tsx";
export { default as Omnibar } from "./components/layout/Omnibar.tsx";
export type {
  SidebarItemProps,
  SidebarMenuItem,
  SidebarProps,
} from "./components/layout/Sidebar.tsx";
export { Sidebar, SidebarItem } from "./components/layout/Sidebar.tsx";
export type {
  DataTableColumn,
  DataTableFilter,
  DataTableProps,
  DataTableSort,
} from "./components/table/DataTable.tsx";
export { default as DataTable } from "./components/table/DataTable.tsx";
export { useDialog } from "./hooks/useDialog.ts";
export { useToast } from "./hooks/useToast.ts";
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
export * from "./utils/icons.tsx";
export * from "./utils/string.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "typebox" {
  interface TSchemaOptions {
    $control?: Omit<ControlProps, "input">;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mantine
 *
 * @module alepha.ui
 */
export const AlephaUI = $module({
  name: "alepha.ui",
  services: [DialogService, ToastService, RootRouter],
  register: (alepha) => {
    alepha.with(AlephaReactI18n);
    alepha.with(AlephaReactHead);
    alepha.with(AlephaReactForm);
    alepha.with(DialogService);
    alepha.with(ToastService);
  },
});
