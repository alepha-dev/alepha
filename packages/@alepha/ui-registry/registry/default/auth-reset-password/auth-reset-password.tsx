import { AlephaError, t } from "alepha";
import type {
  PasswordResetIntentResponse,
  RealmConfig,
  UserController,
} from "alepha/api/users";
import { resetPasswordRequestSchema } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Control } from "@/registry/default/control/control";
import { iconFor } from "@/registry/default/control-base/icon-hint";

export interface AuthResetPasswordProps {
  realmConfig: RealmConfig;
  loginPath?: string;
}

type Step = "email" | "code" | "password" | "success";

interface State {
  step: Step;
  intent?: PasswordResetIntentResponse;
  email?: string;
  code?: string;
}

export function AuthResetPassword(props: AuthResetPasswordProps) {
  const router = useRouter();
  const userCtrl = useClient<UserController>();
  const [state, setState] = useState<State>({ step: "email" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const redirect = router.query.r || "/";

  const settings = props.realmConfig.settings;
  const allowed = settings?.resetPasswordAllowed !== false;
  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";

  const emailForm = useForm({
    schema: resetPasswordRequestSchema,
    handler: async (data) => {
      setError(null);
      const intent = await userCtrl.createPasswordResetIntent({
        query: { userRealmName: props.realmConfig.realmName },
        body: { email: data.email },
      });
      setState({ step: "code", intent, email: data.email });
    },
  });

  const passwordForm = useForm(
    {
      schema: t.object({
        password: t.string({ minLength: 8 }),
        confirmPassword: t.string({ minLength: 8 }),
      }),
      handler: async (data) => {
        if (data.password !== data.confirmPassword) {
          throw new AlephaError("Passwords do not match");
        }
        if (!state.intent || !state.code) {
          throw new AlephaError("Invalid reset state");
        }
        await userCtrl.completePasswordReset({
          body: {
            intentId: state.intent.intentId,
            code: state.code,
            newPassword: data.password,
          },
        });
        setState({ step: "success" });
      },
    },
    [state.intent, state.code],
  );

  const handleCodeSubmit = () => {
    if (code.length === 6) {
      setState((s) => ({ ...s, step: "password", code }));
    }
  };

  const handleResend = async () => {
    if (!state.email) return;
    setSubmitting(true);
    setError(null);
    try {
      const intent = await userCtrl.createPasswordResetIntent({
        query: { userRealmName: props.realmConfig.realmName },
        body: { email: state.email },
      });
      setState((s) => ({ ...s, intent }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resend code");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!allowed ? (
              <>
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    Password reset is not available. Please contact your
                    administrator.
                  </AlertDescription>
                </Alert>
                <Button asChild>
                  <a href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}>
                    Back to sign in
                  </a>
                </Button>
              </>
            ) : state.step === "email" ? (
              <form {...emailForm.props} className="flex flex-col gap-4">
                <h2 className="text-center text-lg font-semibold">
                  Reset password
                </h2>
                <p className="text-muted-foreground text-sm">
                  Enter your email address to reset your password
                </p>
                <Control
                  label="Email"
                  input={emailForm.input.email}
                  icon={iconFor("email")}
                />
                <Button type="submit" disabled={emailForm.submitting}>
                  Send verification code
                </Button>
              </form>
            ) : state.step === "code" ? (
              <div className="flex flex-col gap-4">
                <h2 className="text-center text-lg font-semibold">
                  Reset password
                </h2>
                <Alert>
                  <Info className="size-4" />
                  <AlertDescription>
                    We&apos;ve sent a verification code to your email.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">Enter the 6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                  />
                </div>
                <Button onClick={handleCodeSubmit} disabled={code.length !== 6}>
                  Continue
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={submitting}
                >
                  Resend code
                </Button>
              </div>
            ) : state.step === "password" ? (
              <form {...passwordForm.props} className="flex flex-col gap-4">
                <h2 className="text-center text-lg font-semibold">
                  Reset password
                </h2>
                <p className="text-muted-foreground text-sm">
                  Create your new password
                </p>
                <Control
                  label="New password"
                  input={passwordForm.input.password}
                  password
                />
                <Control
                  label="Confirm password"
                  input={passwordForm.input.confirmPassword}
                  password
                />
                <Button type="submit" disabled={passwordForm.submitting}>
                  Set new password
                </Button>
              </form>
            ) : (
              <>
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertDescription>
                    Your password has been reset successfully.
                  </AlertDescription>
                </Alert>
                <Button asChild>
                  <a href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}>
                    Back to sign in
                  </a>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <Button variant="ghost" asChild>
          <a href={redirect}>Cancel</a>
        </Button>
      </div>
    </div>
  );
}
