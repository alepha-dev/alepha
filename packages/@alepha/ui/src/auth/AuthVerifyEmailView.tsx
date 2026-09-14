import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { Card, CardContent } from "../core/Card.tsx";
import type { VerifyEmailStep } from "./AuthVerifyEmail.tsx";

export interface AuthVerifyEmailViewProps {
  step: VerifyEmailStep;
  error?: string | null;
  loginPath?: string;
  logo?: ReactNode;
}

export const AuthVerifyEmailView = (props: AuthVerifyEmailViewProps) => {
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
};
