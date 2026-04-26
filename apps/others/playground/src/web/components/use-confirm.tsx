import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/web/components/ui/alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When `true`, styles the confirm button as destructive. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

interface State {
  open: boolean;
  options?: ConfirmOptions;
}

/**
 * Provides imperative confirm dialogs through {@link useConfirm}.
 * Mount once near the root: `<ConfirmProvider>{children}</ConfirmProvider>`.
 */
export function ConfirmProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<State>({ open: false });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const handleResolve = (value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState({ open: false });
  };

  const opts = state.options;

  return (
    <Ctx.Provider value={confirm}>
      {props.children}
      <AlertDialog
        open={state.open}
        onOpenChange={(o) => !o && handleResolve(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title ?? ""}</AlertDialogTitle>
            {opts?.description && (
              <AlertDialogDescription>
                {opts.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleResolve(false)}>
              {opts?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleResolve(true)}
              className={
                opts?.destructive
                  ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  : undefined
              }
            >
              {opts?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/**
 * Returns an imperative `confirm({ title, description })` that resolves to a
 * boolean. Requires {@link ConfirmProvider} mounted in the tree.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm requires <ConfirmProvider>");
  return ctx;
}
