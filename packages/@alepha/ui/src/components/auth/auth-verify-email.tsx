import * as React from "react";

void React;

import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import type { UserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

export type VerifyEmailStep = "verifying" | "success" | "error";

export interface AuthVerifyEmailProps {
  /**
   * Route to the login page, shown as a CTA on success/failure.
   */
  loginPath?: string;
  /**
   * Render a fixed step (useful for storybook / testing).
   */
  step?: VerifyEmailStep;
  /**
   * Custom logo node, rendered above the card.
   */
  logo?: ReactNode;
}

export function AuthVerifyEmail(props: AuthVerifyEmailProps) {
  if (props.step) {
    return (
      <View step={props.step} loginPath={props.loginPath} logo={props.logo} />
    );
  }
  return <Stateful loginPath={props.loginPath} logo={props.logo} />;
}

function Stateful(props: { loginPath?: string; logo?: ReactNode }) {
  const state = useRouterState();
  const { tr } = useI18n();
  const userCtrl = useClient<UserController>();
  const [step, setStep] = useState<VerifyEmailStep>("verifying");
  const [error, setError] = useState<string | null>(null);

  const email = state.query.email as string | undefined;
  const token = state.query.token as string | undefined;

  useEffect(() => {
    const verify = async () => {
      if (!email || !token) {
        setError(
          tr("auth.verify.invalidLink", {
            default: "Invalid verification link. Email and token are required.",
          }),
        );
        setStep("error");
        return;
      }
      try {
        await userCtrl.verifyEmail({ body: { email, token } });
        setStep("success");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : tr("auth.verify.failed", {
                default:
                  "Failed to verify your email. The link may have expired or is invalid.",
              }),
        );
        setStep("error");
      }
    };
    void verify();
  }, [email, token, userCtrl, tr]);

  return (
    <View
      step={step}
      error={error}
      loginPath={props.loginPath}
      logo={props.logo}
    />
  );
}

function View(props: {
  step: VerifyEmailStep;
  error?: string | null;
  loginPath?: string;
  logo?: ReactNode;
}) {
  const { tr } = useI18n();
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {props.logo}
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4">
            {props.step === "verifying" && (
              <>
                <Loader2 className="text-muted-foreground size-12 animate-spin" />
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.verify.verifying", {
                    default: "Verifying your email...",
                  })}
                </h2>
                <p className="text-muted-foreground text-center text-sm">
                  {tr("auth.verify.verifyingHint", {
                    default: "Please wait while we verify your email address.",
                  })}
                </p>
              </>
            )}
            {props.step === "success" && (
              <>
                <MailCheck className="size-12 text-green-600" />
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.verify.successTitle", {
                    default: "Email verified",
                  })}
                </h2>
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertDescription>
                    {tr("auth.verify.success", {
                      default: "Your email has been verified successfully.",
                    })}
                  </AlertDescription>
                </Alert>
                <Button
                  nativeButton={false}
                  render={<a href={props.loginPath ?? "/auth/login"} />}
                  className="w-full"
                >
                  {tr("auth.verify.signIn", {
                    default: "Sign in to your account",
                  })}
                </Button>
              </>
            )}
            {props.step === "error" && (
              <>
                <AlertCircle className="text-destructive size-12" />
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.verify.errorTitle", {
                    default: "Email verification failed",
                  })}
                </h2>
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    {props.error ||
                      tr("auth.verify.failed", {
                        default:
                          "Failed to verify your email. The link may have expired or is invalid.",
                      })}
                  </AlertDescription>
                </Alert>
                <Button
                  nativeButton={false}
                  render={<a href={props.loginPath ?? "/auth/login"} />}
                  className="w-full"
                >
                  {tr("auth.verify.backToSignIn", {
                    default: "Back to sign in",
                  })}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
