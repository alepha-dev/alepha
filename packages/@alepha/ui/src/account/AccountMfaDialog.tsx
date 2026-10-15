import type { MyMfaController } from "alepha/api/users";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../otp/InputOTP.tsx";
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
   * Called after enrollment completes, so the caller can refresh its status.
   */
  onDone?: () => void | Promise<void>;
}

/**
 * Enroll an authenticator app: scan, confirm, then write down the recovery
 * codes.
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

  /**
   * A fresh enrollment is started each time the dialog opens, and the
   * previous pending one is replaced server-side. `enabled` keys it to
   * `props.open` so nothing is issued for a dialog nobody asked for. The
   * previous opening's QR is not shown while the new one loads: it names a
   * secret the server has replaced.
   */
  const {
    data: enrollment,
    error,
    loading: enrolling,
  } = useQuery<TotpEnrollment>(
    {
      enabled: props.open,
      handler: () => api.enrollTotp() as Promise<TotpEnrollment>,
    },
    [props.open],
  );

  /**
   * Closing resets the transient state, so reopening does not flash the
   * previous run's recovery codes at whoever is next at the keyboard.
   */
  const setOpen = (open: boolean) => {
    if (!open) {
      setCode("");
      setRecoveryCodes(undefined);
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

  const submit = async (value: string) => {
    if (!(await activate.run(value)).ok) {
      setCode("");
    }
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
        if (!open && (recoveryCodes || activate.loading)) {
          return;
        }
        setOpen(open);
      }}
    >
      <DialogContent showCloseButton={!recoveryCodes && !activate.loading}>
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
                  dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
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
                    disabled={activate.loading}
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

                <Button
                  loading={activate.loading}
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
    </Dialog>
  );
};
