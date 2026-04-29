import { useInject } from "alepha/react";
import { ToastService } from "../services/ToastService.tsx";

/**
 * Use this hook to access the Toast Service for showing notifications.
 *
 * @example
 * ```tsx
 * const toast = useToast();
 * toast.success({ message: "Operation completed successfully!" });
 * toast.error({ title: "Error", message: "Something went wrong" });
 * ```
 */
export const useToast = (): ToastService => {
  return useInject(ToastService);
};
