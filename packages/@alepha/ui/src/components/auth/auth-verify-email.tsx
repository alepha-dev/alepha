import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import type { UserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useRouterState } from "alepha/react/router";
import { AlertCircle, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";

export type VerifyEmailStep = "verifying" | "success" | "error";

export interface AuthVerifyEmailProps {
  loginPath?: string;
  /** Render a fixed step (useful for storybook / testing). */
  step?: VerifyEmailStep;
}

export function AuthVerifyEmail(props: AuthVerifyEmailProps) {
  if (props.step) {
    return <View step={props.step} loginPath={props.loginPath} />;
  }
  return <Stateful loginPath={props.loginPath} />;
}

function Stateful(props: { loginPath?: string }) {
  const state = useRouterState();
  const userCtrl = useClient<UserController>();
  const [step, setStep] = useState<VerifyEmailStep>("verifying");
  const [error, setError] = useState<string | null>(null);

  const email = state.query.email as string | undefined;
  const token = state.query.token as string | undefined;

  useEffect(() => {
    const verify = async () => {
      if (!email || !token) {
        setError("Invalid verification link. Email and token are required.");
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
            : "Failed to verify your email. The link may have expired or is invalid.",
        );
        setStep("error");
      }
    };
    void verify();
  }, [email, token, userCtrl]);

  return <View step={step} error={error} loginPath={props.loginPath} />;
}

function View(props: {
  step: VerifyEmailStep;
  error?: string | null;
  loginPath?: string;
}) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            {props.step === "verifying" && (
              <>
                <Loader2 className="text-muted-foreground size-12 animate-spin" />
                <h2 className="text-center text-lg font-semibold">
                  Verifying your email...
                </h2>
                <p className="text-muted-foreground text-center text-sm">
                  Please wait while we verify your email address.
                </p>
              </>
            )}
            {props.step === "success" && (
              <>
                <MailCheck className="size-12 text-green-600" />
                <h2 className="text-center text-lg font-semibold">
                  Email verified
                </h2>
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertDescription>
                    Your email has been verified successfully.
                  </AlertDescription>
                </Alert>
                <Button asChild className="w-full">
                  <a href={props.loginPath ?? "/auth/login"}>
                    Sign in to your account
                  </a>
                </Button>
              </>
            )}
            {props.step === "error" && (
              <>
                <AlertCircle className="text-destructive size-12" />
                <h2 className="text-center text-lg font-semibold">
                  Email verification failed
                </h2>
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    {props.error ||
                      "Failed to verify your email. The link may have expired or is invalid."}
                  </AlertDescription>
                </Alert>
                <Button asChild className="w-full">
                  <a href={props.loginPath ?? "/auth/login"}>Back to sign in</a>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
