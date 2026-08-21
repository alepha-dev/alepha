import * as React from "react";

void React;

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { AlephaError } from "alepha";
import { useI18n } from "alepha/react/i18n";
import {
  type ChangeEvent,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * When `true`, styles the confirm button as destructive.
   */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
}

export interface PromptOptions {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Optional inline validator. Return `null` for valid, or an error string.
   */
  validate?: (value: string) => string | null;
}

type Kind = "confirm" | "alert" | "prompt";

interface Pending {
  kind: Kind;
  options: ConfirmOptions | AlertOptions | PromptOptions;
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<DialogApi | null>(null);

/**
 * Provides imperative dialog primitives (`confirm`, `alert`, `prompt`)
 * through {@link useDialog}. Mount once near the root:
 * `<DialogProvider>{children}</DialogProvider>`.
 */
export function DialogProvider(props: { children: ReactNode }) {
  const { tr } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const resolverRef = useRef<((value: unknown) => void) | null>(null);

  const open = <T,>(kind: Kind, options: Pending["options"]) =>
    new Promise<T>((resolve) => {
      resolverRef.current = resolve as (value: unknown) => void;
      if (kind === "prompt") {
        const o = options as PromptOptions;
        setPromptValue(o.defaultValue ?? "");
        setPromptError(null);
      }
      setPending({ kind, options });
    });

  const resolve = (value: unknown) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  };

  const confirm = useCallback(
    (options: ConfirmOptions) => open<boolean>("confirm", options),
    [],
  );
  const alert = useCallback(
    (options: AlertOptions) => open<void>("alert", options),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) => open<string | null>("prompt", options),
    [],
  );

  const api = useMemo<DialogApi>(
    () => ({ confirm, alert, prompt }),
    [confirm, alert, prompt],
  );

  const opts = pending?.options as Partial<
    ConfirmOptions & AlertOptions & PromptOptions
  >;

  const handlePromptConfirm = () => {
    const o = pending?.options as PromptOptions;
    if (o?.validate) {
      const err = o.validate(promptValue);
      if (err) {
        setPromptError(err);
        return;
      }
    }
    resolve(promptValue);
  };

  const cancelValue = pending?.kind === "prompt" ? null : false;

  return (
    <Ctx.Provider value={api}>
      {props.children}
      <AlertDialog
        open={!!pending}
        onOpenChange={(o: boolean) => {
          if (!o) resolve(cancelValue);
        }}
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
          {pending?.kind === "prompt" && (
            <div className="flex flex-col gap-2">
              {opts?.label && (
                <label
                  htmlFor="alepha-dialog-prompt-input"
                  className="text-sm font-medium"
                >
                  {opts.label}
                </label>
              )}
              <Input
                id="alepha-dialog-prompt-input"

                value={promptValue}
                placeholder={opts?.placeholder}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setPromptValue(e.target.value);
                  if (promptError) setPromptError(null);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handlePromptConfirm();
                  }
                }}
              />
              {promptError && (
                <p className="text-destructive text-xs">{promptError}</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            {pending?.kind !== "alert" && (
              <AlertDialogCancel onClick={() => resolve(cancelValue)}>
                {opts?.cancelLabel ??
                  tr("useDialog.cancel", { default: "Cancel" })}
              </AlertDialogCancel>
            )}
            <AlertDialogAction
              onClick={() => {
                if (pending?.kind === "prompt") {
                  handlePromptConfirm();
                } else if (pending?.kind === "alert") {
                  resolve(undefined);
                } else {
                  resolve(true);
                }
              }}
              className={
                (opts as ConfirmOptions)?.destructive
                  ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  : undefined
              }
            >
              {opts?.confirmLabel ??
                (pending?.kind === "alert"
                  ? tr("useDialog.ok", { default: "OK" })
                  : tr("useDialog.confirm", { default: "Confirm" }))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/**
 * Imperative dialog API. Returns an object with:
 *
 * - `confirm({ title, description? })` → `Promise<boolean>`
 * - `alert({ title, description? })` → `Promise<void>`
 * - `prompt({ title, label?, defaultValue?, validate? })` → `Promise<string | null>`
 *
 * Requires {@link DialogProvider} mounted in the tree.
 *
 * @example
 * const dialog = useDialog();
 * if (await dialog.confirm({ title: "Delete?", destructive: true })) {
 *   await api.delete();
 * }
 */
export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new AlephaError("useDialog requires <DialogProvider>");
  return ctx;
}
