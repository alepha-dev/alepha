import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { CreateEstateBody } from "@/api/schemas/createEstateBodySchema.ts";
import {
  type EstateCreateDraft,
  emptyEstateDraft,
  estateDraftBody,
  estateDraftValid,
  estateErrorField,
  estateErrorMessage,
} from "@/web/app/components/shared/estateCreateDraft.ts";
import EstateCreateFields from "@/web/app/components/shared/EstateCreateFields.tsx";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface MyEstateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Performs the create. It **rejects** on a refusal rather than reporting
   * it itself, because the message belongs beside the field it concerns and
   * this dialog is the only thing that knows where the fields are.
   */
  onSubmit: (body: CreateEstateBody) => Promise<void>;
}

/**
 * Naming a new estate, and for a Cloudflare one, handing over its token.
 *
 * A dialog rather than the inline card this replaced (feedback #2110). The
 * card was always present, above every estate, so the page opened on a form
 * for the thing you are least often doing.
 *
 * ⚠️ For a `bay` estate it closes on submit and the SECRET dialog opens
 * behind it, which is why the two are separate components rather than one
 * flow: a reveal nested in the create dialog would be dismissed by the same
 * gesture that submits, and the secret cannot be shown twice.
 *
 * ⚠️ For a `cloudflare` estate **nothing is revealed**, because nothing was
 * minted: the user brought the token. The create response carries no
 * `secret` field at all (#1629), which is what keeps `MyEstateSecretDialog`
 * shut here rather than a falsy string somebody could later "fix".
 *
 * ⚠️ The whole check runs before the dialog closes (owner's ruling,
 * 2026-09-06: "add estate, Cloudflare, paste the token, checking, OK").
 * Seven `GET`s to Cloudflare take a few seconds, so the button says so and
 * is disabled while they run; a silent button gets clicked twice.
 */
const MyEstateCreateDialog = (props: MyEstateCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [draft, setDraft] = useState<EstateCreateDraft>(emptyEstateDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    { message: string; field?: "accountId" | "token" } | undefined
  >();

  const valid = estateDraftValid(draft);

  const reset = () => {
    // The token never outlives the dialog that carried it.
    setDraft(emptyEstateDraft());
    setError(undefined);
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.onSubmit(estateDraftBody(draft));
      reset();
    } catch (caught) {
      // Kept open, with the sentence beside the field: the person hitting a
      // Cloudflare refusal is the one least equipped to diagnose it, and a
      // toast is gone before they have read it.
      setError({
        message: estateErrorMessage(caught),
        field: estateErrorField(caught),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        props.onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("account.estates.create")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <EstateCreateFields
            draft={draft}
            onChange={setDraft}
            busy={busy}
            error={error}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => props.onOpenChange(false)}
            >
              {tr("account.estates.create.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!valid || busy}
              data-testid="estate-create-submit"
            >
              {busy && draft.type === "cloudflare" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {busy && draft.type === "cloudflare"
                ? tr("estates.cloudflare.checking")
                : tr("account.estates.create.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default MyEstateCreateDialog;
