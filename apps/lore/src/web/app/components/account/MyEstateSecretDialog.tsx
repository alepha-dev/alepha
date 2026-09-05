import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";
import { Check, Clipboard } from "lucide-react";
import { useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface MyEstateSecretDialogProps {
  /**
   * The cleartext secret, or `undefined` when there is nothing to show. Its
   * presence IS the open state: there is no separate flag, because a dialog
   * that can be open with no secret in it is a dialog that can show an empty
   * box where the credential should be.
   */
  secret?: string;
  onDismiss: () => void;
}

/**
 * The one moment an estate secret exists in a readable form.
 *
 * A dialog rather than a card on the page, and this is the whole of feedback
 * #2109. `estates.secretHash` stores a hash, so dismissing this is final: the
 * only way back is `rotateEstate`, which mints a new secret and invalidates
 * the one the machine is already using. A panel at the top of a page that
 * re-renders on every switch below it is a credential that can scroll out of
 * view and be gone.
 *
 * Same reasoning, and the same shape, as `@alepha/ui`'s `account-keys.tsx`,
 * whose doc states it for API keys: "a token that scrolls out of view behind
 * a re-render is gone".
 *
 * ⚠️ Deliberately NOT auto-dismissed, and deliberately not closed by the
 * create dialog's own submit. Creation and rotation both land here, because
 * both mint.
 */
const MyEstateSecretDialog = (props: MyEstateSecretDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [copied, setCopied] = useState(false);

  const dismiss = () => {
    setCopied(false);
    props.onDismiss();
  };

  const copy = async () => {
    if (!props.secret) return;
    await navigator.clipboard.writeText(props.secret);
    setCopied(true);
    toaster.success(tr("estates.toast.copied"));
  };

  return (
    <Dialog
      open={Boolean(props.secret)}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent data-testid="my-estate-secret-dialog">
        <DialogHeader>
          <DialogTitle>{tr("estates.secret.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <span className="text-muted-foreground text-sm">
            {tr("estates.secret.description")}
          </span>
          <code className="bg-muted rounded-md border p-3 font-mono text-xs break-all">
            {props.secret}
          </code>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Clipboard className="size-4" />
              )}
              {copied ? tr("estates.secret.copied") : tr("estates.secret.copy")}
            </Button>
            <Button onClick={dismiss}>{tr("estates.secret.done")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MyEstateSecretDialog;
