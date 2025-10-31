import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import type { ControlProps } from "./components/Control.tsx";
import { RootRouter } from "./RootRouter.ts";
import { DialogService } from "./services/DialogService.tsx";
import { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export { Flex } from "@mantine/core";
export type {
  ActionActionProps,
  ActionClickProps,
  ActionCommonProps,
  ActionMenuConfig,
  ActionMenuItem,
  ActionProps,
  ActionSubmitProps,
  ActiveHrefProps,
} from "./components/Action.tsx";
export { default as Action, isActionReturn } from "./components/Action.tsx";
export { default as AlephaMantineProvider } from "./components/AlephaMantineProvider.tsx";
export { default as Control } from "./components/Control.tsx";
export { default as ControlDate } from "./components/ControlDate.tsx";
export { default as ControlSelect } from "./components/ControlSelect.tsx";
export { default as DarkModeButton } from "./components/DarkModeButton.tsx";
export type {
  DataTableColumn,
  DataTableFilter,
  DataTableProps,
  DataTableSort,
} from "./components/DataTable.tsx";
export { default as DataTable } from "./components/DataTable.tsx";
export { AlertDialog } from "./components/dialogs/AlertDialog.tsx";
export { ConfirmDialog } from "./components/dialogs/ConfirmDialog.tsx";
export { PromptDialog } from "./components/dialogs/PromptDialog.tsx";
export { default as Omnibar } from "./components/Omnibar.tsx";
export type {
  MenuItem,
  SidebarItemProps,
  SidebarProps,
} from "./components/Sidebar.tsx";
export { Sidebar, SidebarItem } from "./components/Sidebar.tsx";
export { default as TypeForm } from "./components/TypeForm.tsx";
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
  services: [AlephaReact, DialogService, ToastService, RootRouter],
});
