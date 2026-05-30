import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useI18n } from "alepha/react/i18n";
import { type FormEvent, useState } from "react";
import type { I18n } from "../../services/I18n.ts";

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
   * Perform the crypto + persistence. Return an error message to surface
   * inside the dialog (e.g. "wrong passphrase"), or `null` on success —
   * the dialog then resets and closes itself.
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
 */
const FolioPassphraseDialog = (props: FolioPassphraseDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const close = () => {
    setPassphrase("");
    setConfirm("");
    setError(null);
    setWorking(false);
    props.onOpenChange(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    if (props.requireConfirm) {
      if (passphrase !== confirm) {
        setError(tr("folios.protected.passphrase-mismatch"));
        return;
      }
      if (passphrase.length < 8) {
        setError(tr("folios.protected.passphrase-weak"));
        return;
      }
    }
    setWorking(true);
    setError(null);
    try {
      const err = await props.onSubmit(passphrase);
      if (err) {
        setError(err);
        return;
      }
      close();
    } finally {
      setWorking(false);
    }
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="folio-passphrase-dialog" className="text-xs">
              {tr("folios.protected.passphrase")}
            </Label>
            <Input
              id="folio-passphrase-dialog"
              type="password"
              autoComplete={props.requireConfirm ? "new-password" : "off"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
              disabled={working}
              autoFocus
            />
          </div>
          {props.requireConfirm && (
            <>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="folio-passphrase-dialog-confirm"
                  className="text-xs"
                >
                  {tr("folios.protected.passphrase-confirm")}
                </Label>
                <Input
                  id="folio-passphrase-dialog-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.currentTarget.value)}
                  disabled={working}
                />
              </div>
              <p className="text-muted-foreground text-xs italic">
                {tr("folios.protected.create-warning")}
              </p>
            </>
          )}
          {error && (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={working || passphrase.length === 0}>
              {props.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default FolioPassphraseDialog;
