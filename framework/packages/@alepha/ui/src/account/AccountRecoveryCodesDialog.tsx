import { useI18n } from "alepha/react/i18n";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { AccountRecoveryCodes } from "./AccountRecoveryCodes.tsx";

export interface AccountRecoveryCodesDialogProps {
  /**
   * The codes to show, or `undefined` for a closed dialog.
   */
  codes: string[] | undefined;
  onClose: () => void;
}

/**
 * A regenerated set of recovery codes (#Q2518).
 *
 * Closes only on "I have saved them": no close button, and Escape or a click
 * on the backdrop is ignored, because the codes can never be shown again and
 * the old set is already dead.
 */
export const AccountRecoveryCodesDialog = (
  props: AccountRecoveryCodesDialogProps,
) => {
  const { tr } = useI18n();

  return (
    <Dialog open={!!props.codes} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {tr("account.mfa.newRecoveryTitle", {
              default: "Save your new recovery codes",
            })}
          </DialogTitle>
        </DialogHeader>
        {props.codes ? (
          <AccountRecoveryCodes codes={props.codes} onSaved={props.onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
