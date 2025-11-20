import { useInject } from "@alepha/react";
import { DialogService } from "../services/DialogService.tsx";

/**
 * Use this hook to access the Dialog Service for showing various dialog types.
 *
 * @example
 * ```tsx
 * const dialog = useDialog();
 * await dialog.alert({ title: "Alert", message: "This is an alert message" });
 * const confirmed = await dialog.confirm({ title: "Confirm", message: "Are you sure?" });
 * const input = await dialog.prompt({ title: "Input", message: "Enter your name:" });
 * ```
 */
export const useDialog = (): DialogService => {
  return useInject(DialogService);
};
