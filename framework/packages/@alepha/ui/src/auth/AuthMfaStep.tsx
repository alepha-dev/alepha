import * as React from "react";

void React;

import { z } from "alepha";
import { type MfaChallenge, useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { AlertCircle, Fingerprint } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { Control } from "../form/Control.tsx";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../otp/InputOTP.tsx";

export interface AuthMfaStepProps {
  /**
   * The challenge the sign-in was refused with.
   */
  challenge: MfaChallenge;
  /**
   * Called once the code has been accepted and the session exists.
   */
  onVerified: () => void | Promise<void>;
  /**
   * Back to the password form.
   */
  onCancel: () => void;
}

/**
 * Second step of a sign-in: the six-digit code.
 *
 * The same component serves both factors. Only the wording and the resend
 * affordance differ, because to the user the act is identical: read a code,
 * type it in.
 *
 * An authenticator-app step also takes a recovery code, in a text field of
 * its own: a recovery code is longer than six digits and holds letters, so
 * the six-slot field cannot carry one. The server takes it wherever it takes
 * the code, in either format it has issued.
 */
export const AuthMfaStep = (props: AuthMfaStepProps) => {
  const auth = useAuth();
  const { tr } = useI18n();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [sentTo, setSentTo] = useState(props.challenge.sentTo);

  const isEmail = props.challenge.methods.includes("emailCode");
  const [recovery, setRecovery] = useState(false);

  /**
   * Clear the step with a passkey instead of the code. Offered beside the
   * code field, never instead of it: a passkey alone raises no step, so the
   * code this step was raised for is always an option.
   */
  const clearWithPasskey = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const tokens = await auth.loginPasskey({
        challenge: props.challenge.challenge,
      });
      if (tokens) {
        await props.onVerified();
      }
    } catch (err) {
      setError(
        err instanceof HttpError && err.status === 401
          ? tr("auth.mfa.passkeyInvalid", {
              default: "That passkey could not confirm it is you.",
            })
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = async (value: string) => {
    setLoading(true);
    setError(undefined);
    try {
      await auth.loginMfa(props.challenge.challenge, value);
      await props.onVerified();
    } catch (err) {
      setCode("");
      // A 401 here is a wrong or stale code, which is the only failure the
      // user can do anything about. Anything else is ours, not theirs.
      if (err instanceof HttpError && err.status === 401) {
        setError(
          tr("auth.mfa.invalid", {
            default: "That code is not valid. Try again.",
          }),
        );
      } else {
        console.error("Second factor failed:", err);
        setError(
          tr("auth.mfa.error", {
            default: "Something went wrong. Please try again.",
          }),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const recoveryForm = useForm({
    schema: z.object({
      code: z
        .string()
        .min(1)
        .meta({
          requiredMessage: tr("auth.mfa.recoveryRequired", {
            default: "Enter one of your recovery codes",
          }),
        }),
    }),
    // `submit` reports its own failure in the alert above the field.
    onError: () => {},
    handler: async (data) => {
      await submit(data.code.trim());
    },
  });

  const resend = async () => {
    setResending(true);
    setError(undefined);
    try {
      const result = await auth.resendMfaCode(props.challenge.challenge);
      setSentTo(result.sentTo ?? sentTo);
    } catch {
      setError(
        tr("auth.mfa.resendFailed", {
          default: "Could not send a new code. Try again in a moment.",
        }),
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-center text-lg font-semibold">
          {tr("auth.mfa.title", { default: "Two-step verification" })}
        </h2>
        <p className="text-muted-foreground text-center text-sm">
          {isEmail
            ? // Two keys rather than one interpolated with a possibly-empty
              // address: a translation reading "sent to ." is worse than a
              // sentence written for the case where we have nothing to show.
              sentTo
              ? tr("auth.mfa.emailHint", {
                  default: `Enter the code we sent to ${sentTo}.`,
                  args: [sentTo],
                })
              : tr("auth.mfa.emailHintGeneric", {
                  default: "Enter the code we sent to your email address.",
                })
            : recovery
              ? tr("auth.mfa.recoveryHint", {
                  default:
                    "Enter one of the recovery codes you saved when you turned two-step verification on. Each works once.",
                })
              : tr("auth.mfa.totpHint", {
                  default: "Enter the code from your authenticator app.",
                })}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {recovery ? (
        <form {...recoveryForm.props} className="flex flex-col gap-4">
          <Control
            label={tr("auth.mfa.recoveryLabel", { default: "Recovery code" })}
            input={recoveryForm.input.code}
            autoComplete="off"
          />
          <Button type="submit" loading={loading}>
            {tr("auth.mfa.submit", { default: "Verify" })}
          </Button>
        </form>
      ) : (
        <>
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              aria-label={tr("auth.mfa.codeLabel", {
                default: "Verification code",
              })}
              value={code}
              disabled={loading}
              onChange={(value: string) => {
                setCode(value);
                // Submitting on the sixth digit spares the user a button press
                // they would otherwise always have to make.
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
            type="button"
            loading={loading}
            disabled={code.length !== 6}
            onClick={() => submit(code)}
          >
            {tr("auth.mfa.submit", { default: "Verify" })}
          </Button>
        </>
      )}

      {!isEmail && (
        <Button
          type="button"
          variant="minimal"
          disabled={loading}
          onClick={() => {
            setError(undefined);
            setCode("");
            setRecovery(!recovery);
          }}
        >
          {recovery
            ? tr("auth.mfa.useCode", {
                default: "Use a code from your authenticator app",
              })
            : tr("auth.mfa.useRecovery", { default: "Use a recovery code" })}
        </Button>
      )}

      {props.challenge.passkey && (
        <Button
          type="button"
          variant="outlined"
          intent="none"
          loading={loading}
          onClick={() => void clearWithPasskey()}
        >
          <Fingerprint className="size-4" />
          {tr("auth.mfa.usePasskey", { default: "Use a passkey" })}
        </Button>
      )}

      {isEmail && (
        <Button
          type="button"
          variant="minimal"
          loading={resending}
          onClick={resend}
        >
          {tr("auth.mfa.resend", { default: "Send a new code" })}
        </Button>
      )}

      <Button type="button" variant="minimal" onClick={props.onCancel}>
        {tr("auth.mfa.back", { default: "Back to sign in" })}
      </Button>
    </div>
  );
};
