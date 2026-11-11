import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { useFieldValue, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

export interface FolioPassphraseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  /**
   * When true, render a second "confirm passphrase" field and enforce
   * match + min-length 8 locally before calling `onSubmit`. Used by the
   * encrypt (set-passphrase) flow; omitted for the unlock flow.
   */
  requireConfirm?: boolean;
  /**
   * Perform the crypto + persistence. Return an error message, toasted
   * while the dialog stays open (e.g. "wrong passphrase"), or `null` on
   * success: the dialog then resets and closes itself.
   *
   * The passphrase is the only thing handed up; all crypto lives in the
   * caller so this component stays a dumb modal form.
   */
  onSubmit: (passphrase: string) => Promise<string | null>;
}

/**
 * Modal that collects a folio passphrase. Two shapes:
 *
 * - `requireConfirm` — a "set a new passphrase" form (passphrase +
 *   confirm + strength warning), used when encrypting a clear folio.
 * - default — a single-field "enter passphrase" form, used to unlock an
 *   encrypted folio for viewing.
 *
 * The plaintext passphrase never leaves this component except through the
 * `onSubmit` callback; it is cleared from state on close.
 *
 * The fields are `@alepha/ui`'s password `Control`, with the show/hide eye
 * (#Q3422). A mismatch, a weak passphrase or a refused one is an error toast
 * (#Q3421), where it was a small red line under the form, easy to miss; the
 * dialog stays open so the reader can try again.
 */
const FolioPassphraseDialog = (props: FolioPassphraseDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();

  const form = useForm({
    schema: z.object({
      passphrase: z.string(),
      confirm: z.string().optional(),
    }),
    initialValues: { passphrase: "", confirm: "" },
    handler: async ({ passphrase, confirm }) => {
      if (!passphrase) return;
      if (props.requireConfirm) {
        if (passphrase !== confirm) {
          toast.error(tr("folios.protected.passphrase-mismatch"));
          return;
        }
        if (passphrase.length < 8) {
          toast.error(tr("folios.protected.passphrase-weak"));
          return;
        }
      }
      const err = await props.onSubmit(passphrase);
      if (err) {
        toast.error(err);
        return;
      }
      close();
    },
  });
  const state = useFormState(form);
  const [passphraseValue] = useFieldValue(form.input.passphrase);
  const passphrase = (passphraseValue as string | undefined) ?? "";

  const close = () => {
    form.reset();
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description && (
            <DialogDescription>{props.description}</DialogDescription>
          )}
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-3">
          <Control
            input={form.input.passphrase}
            password
            label={tr("folios.protected.passphrase")}
            autoComplete={props.requireConfirm ? "new-password" : "off"}
            disabled={state.loading}
          />
          {props.requireConfirm && (
            <>
              <Control
                input={form.input.confirm}
                password
                label={tr("folios.protected.passphrase-confirm")}
                autoComplete="new-password"
                disabled={state.loading}
              />
              <p className="text-muted-foreground text-xs italic">
                {tr("folios.protected.create-warning")}
              </p>
            </>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={state.loading || passphrase.length === 0}
            >
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FolioPassphraseDialog;
