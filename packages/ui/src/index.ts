import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import type { ControlProps } from "./components/Control.tsx";
import { RootRouter } from "./RootRouter.ts";
import { ToastService } from "./services/ToastService.tsx";

// ---------------------------------------------------------------------------------------------------------------------

export { Flex } from "@mantine/core";
export { default as Action } from "./components/Action.tsx";
export { default as AlephaMantineProvider } from "./components/AlephaMantineProvider.tsx";
export { default as Control } from "./components/Control.tsx";
export { default as ControlDate } from "./components/ControlDate.tsx";
export { default as ControlSelect } from "./components/ControlSelect.tsx";
export { default as DarkModeButton } from "./components/DarkModeButton.tsx";
export { default as Omnibar } from "./components/Omnibar.tsx";
export { default as TypeForm } from "./components/TypeForm.tsx";
export { useToast } from "./hooks/useToast.ts";
export * from "./RootRouter.ts";
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
 *
 *
 * @module alepha.ui
 */
export const AlephaUI = $module({
  name: "alepha.ui",
  services: [AlephaReact, ToastService, RootRouter],
});
