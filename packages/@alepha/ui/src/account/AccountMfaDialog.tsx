import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@alepha/ui/components/ui/input-otp";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { MyMfaController } from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

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
  const toaster = useToast();
  const { tr } = useI18n();

  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [submitting, setSubmitting] = useState(false);

  /**
   * A fresh enrollment is started each time the dialog opens, and the
   * previous pending one is replaced server-side. `enabled` keys it to
   * `props.open` so nothing is issued for a dialog nobody asked for.
   */
  const { data: enrollment, error } = useQuery<TotpEnrollment>(
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

  const activate = async (value: string) => {
    setSubmitting(true);
    try {
      const result = await api.activateTotp({ body: { code: value } });
      setRecoveryCodes(result.recoveryCodes);
      await props.onDone?.();
    } catch (error: any) {
      setCode("");
      toaster.show(
        error?.message ??
          tr("account.mfa.invalidCode", { default: "That code is not valid" }),
        "danger",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={setOpen}>
      <DialogContent>
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
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>
                {tr("account.mfa.recoveryDescription", {
                  default:
                    "Keep these somewhere safe. Each one works once, and this is the only time they can be shown.",
                })}
              </AlertDescription>
            </Alert>

            <div className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-4 font-mono text-sm">
              {recoveryCodes.map((recovery) => (
                <span key={recovery}>{recovery}</span>
              ))}
            </div>

            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
                toaster.show(
                  tr("account.mfa.recoveryCopied", {
                    default: "Recovery codes copied",
                  }),
                  "success",
                );
              }}
            >
              {tr("account.mfa.copyCodes", { default: "Copy codes" })}
            </Button>

            <Button onClick={() => setOpen(false)}>
              {tr("account.mfa.saved", { default: "I have saved them" })}
            </Button>
          </div>
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

            {enrollment ? (
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
                    disabled={submitting}
                    onChange={(value: string) => {
                      setCode(value);
                      if (value.length === 6) {
                        void activate(value);
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
                  loading={submitting}
                  disabled={code.length !== 6}
                  onClick={() => activate(code)}
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
