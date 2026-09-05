import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "@/api/schemas/estateSlugSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface MyEstateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  /**
   * Given the normalized slug. The caller owns the request, because it also
   * owns the list this inserts into and the secret dialog that follows.
   */
  onSubmit: (slug: string) => void;
}

/**
 * Naming a new estate.
 *
 * A dialog rather than the inline card this replaced (feedback #2110). The
 * card was always present, above every estate, so the page opened on a form
 * for the thing you are least often doing.
 *
 * ⚠️ It closes on submit and the SECRET dialog opens behind it, which is why
 * the two are separate components rather than one flow: a reveal nested in
 * the create dialog would be dismissed by the same gesture that submits, and
 * the secret cannot be shown twice.
 */
const MyEstateCreateDialog = (props: MyEstateCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [slug, setSlug] = useState("");

  const normalized = slug.trim().toLowerCase();
  const valid = ESTATE_SLUG_PATTERN.test(normalized);
  // Only once something has been typed: an empty field is not yet a mistake.
  const showError = normalized.length > 0 && !valid;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) setSlug("");
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
            if (!valid || props.busy) return;
            props.onSubmit(normalized);
            setSlug("");
          }}
        >
          <span className="text-muted-foreground text-sm">
            {tr("account.estates.create.description")}
          </span>
          <div className="flex flex-col gap-1">
            <Input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={tr("estates.add.slugPlaceholder")}
              maxLength={ESTATE_SLUG_MAX_LENGTH}
              aria-label={tr("estates.add.slug")}
              aria-invalid={showError || undefined}
              data-testid="estate-create-slug"
            />
            {showError && (
              <span className="text-destructive text-xs">
                {tr("estates.add.invalid")}
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("account.estates.create.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!valid || props.busy}
              data-testid="estate-create-submit"
            >
              {tr("account.estates.create.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default MyEstateCreateDialog;
