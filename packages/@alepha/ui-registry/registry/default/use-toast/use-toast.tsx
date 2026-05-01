import { toast } from "sonner";

export type Toast = typeof toast;

/**
 * Imperative toast API — thin facade over sonner. Returns the same `toast`
 * function exposed by `sonner`, so all variants are available:
 *
 * - `toast(message)` — neutral
 * - `toast.success(message)` / `toast.error(message)` / `toast.info(message)`
 * - `toast.warning(message)` / `toast.loading(message)`
 * - `toast.promise(promise, { loading, success, error })`
 * - `toast.dismiss(id?)`
 *
 * Requires a `<Toaster />` mounted somewhere in the tree (sonner).
 *
 * Wrapped as a hook for API consistency with {@link useDialog} and to leave
 * room for an Alepha-side `ToastService` (e.g. an atom-driven default
 * duration / position) without changing call sites.
 *
 * @example
 * const toast = useToast();
 * toast.success("Saved");
 * await toast.promise(api.save(), {
 *   loading: "Saving...",
 *   success: "Saved",
 *   error: "Failed",
 * });
 */
export function useToast(): Toast {
  return toast;
}
