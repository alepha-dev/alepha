import * as React from "react";

void React;

import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@alepha/ui/components/ui/input-otp";
import { type MfaChallenge, useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { HttpError } from "alepha/server";
import { AlertCircle } from "lucide-react";
import { useState } from "react";

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

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
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

      {isEmail && (
        <Button
          type="button"
          variant="ghost"
          loading={resending}
          onClick={resend}
        >
          {tr("auth.mfa.resend", { default: "Send a new code" })}
        </Button>
      )}

      <Button type="button" variant="ghost" onClick={props.onCancel}>
        {tr("auth.mfa.back", { default: "Back to sign in" })}
      </Button>
    </div>
  );
};
