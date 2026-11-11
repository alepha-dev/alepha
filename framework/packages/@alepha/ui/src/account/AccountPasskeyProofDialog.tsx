import type { PasskeyProof, PasskeyProofKind } from "alepha/api/users";
import type { RunResult } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type FormEvent, useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { ControlPassword } from "../form/ControlPassword.tsx";

export interface AccountPasskeyProofDialogProps {
  /**
   * The proof this account owes, as `GET /users/me/passkeys` says it. The
   * dialog never re-derives it. `undefined` closes the dialog.
   */
  kind?: Exclude<PasskeyProofKind, "none">;

  /**
   * What is being proved: decides the copy, and for an add with a passkey,
   * that two prompts follow one another.
   */
  purpose: "add" | "remove";

  /**
   * A step-up assertion from one of the account's passkeys, for `passkey`.
   */
  prove: () => Promise<RunResult<unknown>>;

  /**
   * Run the write with the proof. Its error, when it fails, is shown in the
   * dialog, which stays open.
   */
  onProof: (proof: PasskeyProof) => Promise<RunResult<unknown>>;

  onClose: () => void;
}

/**
 * The proof adding or removing a passkey asks for: the current password, or
 * a confirmation with a passkey the account already holds. An account that
 * owes nothing never opens it. A dismissed prompt closes nothing and writes
 * nothing.
 */
export const AccountPasskeyProofDialog = (
  props: AccountPasskeyProofDialogProps,
) => {
  const { tr } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCurrentPassword("");
    setError(undefined);
    props.onClose();
  };

  const finish = async (proof: PasskeyProof) => {
    const result = await props.onProof(proof);
    if (result.ok) {
      close();
    } else if (result.reason === "error") {
      setError(
        result.error instanceof Error ? result.error.message : undefined,
      );
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (props.kind === "password") {
        await finish({ currentPassword });
        return;
      }
      const assertion = await props.prove();
      if (assertion.ok) {
        await finish({
          assertion: assertion.value as PasskeyProof["assertion"],
        });
      } else if (assertion.reason === "error") {
        setError(
          assertion.error instanceof Error
            ? assertion.error.message
            : undefined,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!props.kind} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("account.passkeys.proofTitle", {
              default: "Confirm it is you",
            })}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <span className="text-muted-foreground text-sm">
            {props.kind === "password"
              ? tr("account.passkeys.proofPassword", {
                  default: "Enter your current password to continue.",
                })
              : props.purpose === "add"
                ? tr("account.passkeys.proofPasskeyAdd", {
                    default:
                      "Confirm with a passkey you already have. Your browser then asks you to create the new one: two prompts, one after the other.",
                  })
                : tr("account.passkeys.proofPasskey", {
                    default: "Confirm with a passkey you already have.",
                  })}
          </span>
          {props.kind === "password" ? (
            <ControlPassword
              id="passkeyProofPassword"
              label={tr("account.password.current", {
                default: "Current password",
              })}
              value={currentPassword}
              onChange={setCurrentPassword}
              error={error}
              autoComplete="current-password"
            />
          ) : error ? (
            <span className="text-danger text-sm" role="alert">
              {error}
            </span>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="minimal"
              onClick={() => close()}
              disabled={busy}
            >
              {tr("account.passkeys.cancel", { default: "Cancel" })}
            </Button>
            <Button type="submit" loading={busy}>
              {tr("account.passkeys.proofContinue", { default: "Continue" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
