import type {
  MyMfaController,
  PasskeyProof,
  PasskeyProofKind,
} from "alepha/api/users";
import {
  type RunResult,
  TrustedTypes,
  useAction,
  useClient,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../otp/InputOTP.tsx";
import { AccountPasskeyProofDialog } from "./AccountPasskeyProofDialog.tsx";
import { AccountRecoveryCodes } from "./AccountRecoveryCodes.tsx";

/**
 * What `enrollTotp` hands back: the secret in clear, the `otpauth://` URI,
 * and that URI already rendered as an SVG QR code.
 */
interface TotpEnrollment {
  secret: string;
  uri: string;
  qrSvg: string;
}

export interface AccountMfaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The proof turning the factor on asks of this account, as
   * `GET /users/me/passkeys` says it: the current password, a passkey it
   * already holds, or nothing (the default).
   */
  proof?: PasskeyProofKind;

  /**
   * A step-up assertion from one of the account's passkeys
   * (`usePasskey().prove`), for an account whose proof is `passkey`.
   */
  prove?: () => Promise<RunResult<unknown>>;
  /**
   * Called after enrollment completes, so the caller can refresh its status.
   */
  onDone?: () => void | Promise<void>;
}

/**
 * Enroll an authenticator app: scan, confirm, then write down the recovery
 * codes.
 *
 * Once the code is typed, an account that owes a proof gives it in
 * {@link AccountPasskeyProofDialog}, and the two go to the server together:
 * a borrowed session cannot turn the factor on with an authenticator of its
 * own.
 *
 * The recovery-code step is not a formality and is deliberately hard to
 * skip past. The secret is stored encrypted and the codes hashed, so this
 * dialog is the only moment either can ever be displayed; a user who closes
 * it without keeping the codes has no way back in if they lose the phone,
 * short of an administrator resetting the factor for them.
 */
export const AccountMfaDialog = (props: AccountMfaDialogProps) => {
  const api = useClient<MyMfaController>();
  const { tr } = useI18n();

  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  // The code waiting for its proof: set, the proof dialog is open.
  const [pendingCode, setPendingCode] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const proofKind = props.proof ?? "none";
  const prove =
    props.prove ??
    (async (): Promise<RunResult<unknown>> => ({
      ok: false,
      reason: "cancelled",
    }));

  /**
   * A fresh enrollment is started each time the dialog opens, and the
   * previous pending one is replaced server-side. Nothing is issued for a
   * dialog nobody asked for.
   *
   * The enrollment is this dialog's own state, dropped as soon as it closes,
   * not the `data` of a query: a query keeps its last result until the next
   * one lands, and the dialog stays mounted with the page, so the secret of
   * an enrollment just activated stayed in memory, readable from the page,
   * after the dialog was gone. The server keeps it encrypted; nothing here
   * keeps it at all. A closed dialog also cannot show the previous opening's
   * QR while the new one loads: it names a secret the server has replaced.
   */
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  const enroll = useAction<[]>(
    {
      handler: async (ctx) => {
        const value = (await api.enrollTotp()) as TotpEnrollment;
        if (!ctx.signal.aborted) {
          setEnrollment(value);
        }
      },
    },
    [api],
  );
  const { error, loading: enrolling } = enroll;
  useEffect(() => {
    if (props.open) {
      void enroll.refetch();
      return;
    }
    // One still in flight lands nowhere: its handler sees the abort.
    enroll.cancel();
  }, [props.open]);

  /**
   * Closing resets the transient state, so reopening does not flash the
   * previous run's recovery codes at whoever is next at the keyboard, and
   * drops the enrollment with its secret.
   */
  const setOpen = (open: boolean) => {
    if (!open) {
      setEnrollment(undefined);
      setCode("");
      setRecoveryCodes(undefined);
      setPendingCode(undefined);
      setCodeError(undefined);
    }
    props.onOpenChange(open);
  };

  // A refused code is toasted by the app's ActionErrorToaster, like any
  // other failed action; the field is cleared for the next attempt.
  const activate = useAction<[code: string]>(
    {
      handler: async (_ctx, value) => {
        const result = await api.activateTotp({ body: { code: value } });
        setRecoveryCodes(result.recoveryCodes);
        await props.onDone?.();
      },
    },
    [api, props.onDone],
  );

  // The same write with its proof. Its failures are shown here, not toasted:
  // a refused proof on the proof dialog's own field, a refused code above
  // the code field.
  const activateProved = useAction<[code: string, proof: PasskeyProof]>(
    {
      handler: async (_ctx, value, proof) => {
        const result = await api.activateTotp({
          body: { code: value, proof },
        });
        setRecoveryCodes(result.recoveryCodes);
        await props.onDone?.();
      },
      onError: useCallback(() => {}, []),
    },
    [api, props.onDone],
  );
  const activating = activate.loading || activateProved.loading;

  const submit = async (value: string) => {
    setCodeError(undefined);
    if (proofKind !== "none") {
      setPendingCode(value);
      return;
    }
    if (!(await activate.run(value)).ok) {
      setCode("");
    }
  };

  /**
   * Send the pending code with the proof the dialog collected. A refused
   * proof stays on the proof dialog, which shows it and keeps the code; any
   * other refusal (a wrong or expired code) closes it and is shown above the
   * code field, which is cleared for the next attempt.
   */
  const submitProved = async (
    proof: PasskeyProof,
  ): Promise<RunResult<unknown>> => {
    const result = await activateProved.run(pendingCode ?? "", proof);
    if (result.ok || result.reason !== "error") {
      return result;
    }
    const name = (result.error as { name?: string } | undefined)?.name;
    if (
      name === "PASSKEY_PASSWORD_PROOF" ||
      name === "PASSKEY_ASSERTION_PROOF"
    ) {
      return result;
    }
    setCodeError(
      result.error instanceof Error ? result.error.message : undefined,
    );
    setPendingCode(undefined);
    setCode("");
    return { ok: false, reason: "aborted" };
  };

  return (
    // While the codes are on screen the dialog closes only through "I have
    // saved them" (#Q2518): no close button, and Escape or a backdrop click
    // is ignored. Every close path used to clear the codes, which can never
    // be shown again.
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        // Not while activating either: the codes it is about to return
        // could never be shown again.
        if (!open && (recoveryCodes || activating)) {
          return;
        }
        setOpen(open);
      }}
    >
      <DialogContent showCloseButton={!recoveryCodes && !activating}>
        <DialogHeader>
          <DialogTitle>
            {recoveryCodes
              ? tr("account.mfa.recoveryTitle", {
                  default: "Save your recovery codes",
                })
              : tr("account.mfa.setupTitle", {
                  default: "Set up two-factor authentication",
                })}
          </DialogTitle>
        </DialogHeader>

        {recoveryCodes ? (
          <AccountRecoveryCodes
            codes={recoveryCodes}
            onSaved={() => setOpen(false)}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
              {tr("account.mfa.setupDescription", {
                default:
                  "Scan this with your authenticator app, then type the six-digit code it shows.",
              })}
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  {tr("account.mfa.enrollError", {
                    default:
                      "Could not start the enrollment. Close this and try again.",
                  })}
                </AlertDescription>
              </Alert>
            )}

            {enrollment && !enrolling ? (
              <>
                <div
                  className="mx-auto w-48 rounded-lg bg-white p-3 [&>svg]:w-full"
                  // The QR is generated server-side, from a URI the server
                  // built itself. No user input reaches it.
                  dangerouslySetInnerHTML={{
                    __html: TrustedTypes.html(enrollment.qrSvg),
                  }}
                />

                <details className="text-muted-foreground text-center text-xs">
                  <summary>
                    {tr("account.mfa.cannotScan", {
                      default: "Cannot scan the code?",
                    })}
                  </summary>
                  <p className="mt-2 font-mono break-all">
                    {enrollment.secret}
                  </p>
                </details>

                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    disabled={activating}
                    onChange={(value: string) => {
                      setCode(value);
                      if (value.length === 6) {
                        void submit(value);
                      }
                    }}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot key={index} index={index} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                {codeError ? (
                  <span
                    className="text-danger text-center text-sm"
                    role="alert"
                  >
                    {codeError}
                  </span>
                ) : null}

                <Button
                  loading={activating}
                  disabled={code.length !== 6}
                  onClick={() => submit(code)}
                >
                  {tr("account.mfa.turnOn", { default: "Turn on" })}
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-center text-sm">
                {tr("account.mfa.preparing", { default: "Preparing..." })}
              </p>
            )}
          </div>
        )}
      </DialogContent>

      <AccountPasskeyProofDialog
        // Under this dialog's root, so it opens as a dialog nested in it. A
        // new one for each code: nothing typed for the last one stays.
        key={pendingCode ?? "closed"}
        kind={
          pendingCode !== undefined && proofKind !== "none"
            ? proofKind
            : undefined
        }
        purpose="change"
        prove={prove}
        onProof={submitProved}
        onClose={() => {
          setPendingCode(undefined);
          setCode("");
        }}
      />
    </Dialog>
  );
};
