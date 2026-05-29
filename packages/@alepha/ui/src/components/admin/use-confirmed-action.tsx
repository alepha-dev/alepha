import {
  type ConfirmOptions,
  useDialog,
} from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAction } from "alepha/react";
import type { DependencyList } from "react";

export interface UseConfirmedActionConfig<TArgs extends unknown[]> {
  /**
   * Confirmation dialog shown before the handler runs. Either static options or
   * a function of the same args passed to `run` (e.g. to interpolate a name /
   * count into the message).
   */
  confirm: ConfirmOptions | ((...args: TArgs) => ConfirmOptions);
  /**
   * The mutation. Runs only if the user confirms. Receives the same args as
   * `run` (e.g. the row + a `refresh` callback from `AlephaTable`'s row/bulk
   * action context). Errors surface via the global action-error toaster.
   */
  handler: (...args: TArgs) => void | Promise<void>;
  /**
   * Optional success toast shown after the handler resolves.
   */
  success?: string | ((...args: TArgs) => string);
}

export interface UseConfirmedActionReturn<TArgs extends unknown[]> {
  run: (...args: TArgs) => Promise<void | undefined>;
  loading: boolean;
}

/**
 * The recurring admin pattern — confirm, then mutate, then toast — in one hook.
 * Wraps {@link useAction} (so failures still emit `react:action:error` for the
 * global toaster) plus `useDialog().confirm` and an optional success toast.
 *
 * @example
 * ```tsx
 * const remove = useConfirmedAction<[FileResource, () => void]>(
 *   {
 *     confirm: (file) => ({
 *       title: tr("admin.files.deleteTitle", { default: "Delete file" }),
 *       description: tr("admin.files.deleteConfirm", {
 *         default: `Delete "${file.name}"?`, args: [file.name],
 *       }),
 *       destructive: true,
 *     }),
 *     handler: async (file, refresh) => {
 *       await client.deleteFile({ params: { id: file.id } });
 *       refresh();
 *     },
 *     success: tr("admin.files.deleted", { default: "File deleted" }),
 *   },
 *   [client, tr],
 * );
 * // rowActions: onClick: (_f, { refresh }) => remove.run(file, refresh)
 * ```
 */
export function useConfirmedAction<TArgs extends unknown[]>(
  config: UseConfirmedActionConfig<TArgs>,
  deps: DependencyList,
): UseConfirmedActionReturn<TArgs> {
  const dialog = useDialog();
  const toast = useToast();

  const action = useAction<TArgs, void>(
    {
      handler: async (...argsWithCtx) => {
        // useAction appends an ActionContext as the last argument — strip it so
        // the caller's `confirm` / `handler` / `success` see only their args.
        const args = argsWithCtx.slice(0, -1) as unknown as TArgs;
        const options =
          typeof config.confirm === "function"
            ? config.confirm(...args)
            : config.confirm;
        const confirmed = await dialog.confirm(options);
        if (!confirmed) return;
        await config.handler(...args);
        if (config.success != null) {
          toast.success(
            typeof config.success === "function"
              ? config.success(...args)
              : config.success,
          );
        }
      },
    },
    deps,
  );

  return { run: action.run, loading: action.loading };
}
