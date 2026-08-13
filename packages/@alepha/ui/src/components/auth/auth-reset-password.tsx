import * as React from "react";

void React;

import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@alepha/ui/components/captcha/turnstile-widget";
import { Control } from "@alepha/ui/components/control/control";
import { iconFor } from "@alepha/ui/components/control-base/icon-hint";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@alepha/ui/components/ui/input-otp";
import { Label } from "@alepha/ui/components/ui/label";
import { AlephaError, z } from "alepha";
import type {
  PasswordResetIntentResponse,
  RealmConfig,
  UserController,
} from "alepha/api/users";
import { resetPasswordRequestSchema } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface AuthResetPasswordProps {
  /**
   * Realm configuration (controls verification channel and password rules).
   */
  realmConfig: RealmConfig;
  /**
   * Route to the login page, used after a successful reset.
   */
  loginPath?: string;
  /**
   * Custom logo node, rendered above the form. When provided, it replaces
   * the default `settings.logoUrl` <img>. Use this to inject a branded
   * component (e.g. with light/dark variants or an animation).
   */
  logo?: ReactNode;
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
  const { tr } = useI18n();
  const userCtrl = useClient<UserController>();
  const [state, setState] = useState<State>({ step: "email" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const redirect = router.query.redirect || "/";

  const settings = props.realmConfig.settings;
  const allowed = settings?.resetPasswordAllowed !== false;
  // Keep BOTH realm and the post-auth redirect on the "back to sign in"
  // links so a reset started mid-flow (OIDC continuation) resumes after
  // login. Mirrors auth-login / auth-register.
  const realmBit = props.realmConfig.realmName
    ? `realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";
  const redirectBit =
    typeof router.query.redirect === "string" && router.query.redirect
      ? `redirect=${encodeURIComponent(router.query.redirect)}`
      : "";
  const linkQ = [realmBit, redirectBit].filter(Boolean).join("&");
  const realmQuery = linkQ ? `?${linkQ}` : "";

  /**
   * Captcha, mirroring the registration screen.
   *
   * `createPasswordResetIntent` rejects a request with no token whenever the
   * realm sets `captchaRequired` — it sends mail in our name, so it is gated
   * exactly like registration. Without a widget here the screen could not
   * satisfy that gate at all and every reset answered 400.
   */
  const captchaSiteKey = props.realmConfig.captchaSiteKey;
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const captchaRef = useRef<TurnstileWidgetHandle | null>(null);
  /*
   * `useForm` memoizes its handler at form-create time, so the handler closes
   * over the *initial* `captchaToken` — `undefined` — and would post that
   * forever. Mirror the live value into a ref the handler reads at submit
   * time. Same reason, same fix as `auth-register.tsx`.
   */
  const captchaTokenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    captchaTokenRef.current = captchaToken;
  }, [captchaToken]);

  /**
   * Turnstile tokens are single-use, and both the first send and every resend
   * hit the same gated endpoint. Drop the spent token and re-arm the widget
   * so the next request carries a fresh one rather than a replay the server
   * will refuse.
   */
  const consumeCaptcha = () => {
    if (!captchaSiteKey) return;
    setCaptchaToken(undefined);
    captchaRef.current?.reset();
  };

  const emailForm = useForm({
    schema: resetPasswordRequestSchema,
    handler: async (data) => {
      setError(null);
      try {
        const intent = await userCtrl.createPasswordResetIntent({
          query: { userRealmName: props.realmConfig.realmName },
          body: {
            email: data.email,
            captchaToken: captchaSiteKey ? captchaTokenRef.current : undefined,
          },
        });
        setState({ step: "code", intent, email: data.email });
      } finally {
        consumeCaptcha();
      }
    },
  });

  const passwordForm = useForm(
    {
      schema: z.object({
        password: z.string().min(8),
        confirmPassword: z.string().min(8),
      }),
      handler: async (data) => {
        if (data.password !== data.confirmPassword) {
          throw new AlephaError(
            tr("auth.reset.passwordsMismatch", {
              default: "Passwords do not match",
            }),
          );
        }
        if (!state.intent || !state.code) {
          throw new AlephaError(
            tr("auth.reset.invalidState", { default: "Invalid reset state" }),
          );
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

  const { loading: emailSubmitting } = useFormState(emailForm, ["loading"]);
  const { loading: passwordSubmitting } = useFormState(passwordForm, [
    "loading",
  ]);

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
        body: {
          email: state.email,
          captchaToken: captchaSiteKey ? captchaTokenRef.current : undefined,
        },
      });
      setState((s) => ({ ...s, intent }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : tr("auth.reset.resendFailed", {
              default: "Failed to resend code",
            }),
      );
    } finally {
      setSubmitting(false);
      consumeCaptcha();
    }
  };

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {props.logo ??
          (settings?.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={settings.displayName || props.realmConfig.realmName}
              className="size-16 rounded-xl border bg-muted object-cover shadow-sm"
            />
          ) : null)}
        <Card className="w-full">
          <CardContent className="flex flex-col gap-4">
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
                    {tr("auth.reset.disabled", {
                      default:
                        "Password reset is not available. Please contact your administrator.",
                    })}
                  </AlertDescription>
                </Alert>
                <Button
                  render={
                    <a
                      href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
                    />
                  }
                >
                  {tr("auth.reset.backToSignIn", {
                    default: "Back to sign in",
                  })}
                </Button>
              </>
            ) : state.step === "email" ? (
              <form {...emailForm.props} className="flex flex-col gap-4">
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.reset.title", { default: "Reset password" })}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {tr("auth.reset.emailHint", {
                    default: "Enter your email address to reset your password",
                  })}
                </p>
                <Control
                  label={tr("auth.reset.email", { default: "Email" })}
                  input={emailForm.input.email}
                  icon={iconFor("email")}
                />
                {captchaSiteKey && (
                  <TurnstileWidget
                    ref={captchaRef}
                    siteKey={captchaSiteKey}
                    onToken={setCaptchaToken}
                    className="flex justify-center"
                  />
                )}
                <Button
                  type="submit"
                  loading={emailSubmitting}
                  disabled={!!captchaSiteKey && !captchaToken}
                >
                  {tr("auth.reset.sendCode", {
                    default: "Send verification code",
                  })}
                </Button>
              </form>
            ) : state.step === "code" ? (
              <div className="flex flex-col gap-4">
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.reset.title", { default: "Reset password" })}
                </h2>
                <Alert>
                  <Info className="size-4" />
                  <AlertDescription>
                    {tr("auth.reset.codeSent", {
                      default: "We've sent a verification code to your email.",
                    })}
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col items-center gap-2">
                  <Label htmlFor="code">
                    {tr("auth.reset.codeLabel", {
                      default: "Enter the 6-digit code",
                    })}
                  </Label>
                  <InputOTP
                    id="code"
                    maxLength={6}
                    autoFocus
                    value={code}
                    onChange={(value) => setCode(value.replace(/\D/g, ""))}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button onClick={handleCodeSubmit} disabled={code.length !== 6}>
                  {tr("auth.reset.continue", { default: "Continue" })}
                </Button>
                {/* Resend calls the same gated endpoint as the first send,
                    and the token that got us here is already spent — so this
                    step needs its own challenge rather than reusing one. */}
                {captchaSiteKey && (
                  <TurnstileWidget
                    ref={captchaRef}
                    siteKey={captchaSiteKey}
                    onToken={setCaptchaToken}
                    className="flex justify-center"
                  />
                )}
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  loading={submitting}
                  disabled={!!captchaSiteKey && !captchaToken}
                >
                  {tr("auth.reset.resend", { default: "Resend code" })}
                </Button>
              </div>
            ) : state.step === "password" ? (
              <form {...passwordForm.props} className="flex flex-col gap-4">
                {/* Hidden identifier so password managers know which saved
                    credential the new password belongs to. Without it,
                    Safari/Chrome won't offer to update the existing entry. */}
                {state.email && (
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={state.email}
                    readOnly
                    hidden
                  />
                )}
                <h2 className="text-center text-lg font-semibold">
                  {tr("auth.reset.title", { default: "Reset password" })}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {tr("auth.reset.newPasswordHint", {
                    default: "Create your new password",
                  })}
                </p>
                <Control
                  label={tr("auth.reset.newPassword", {
                    default: "New password",
                  })}
                  input={passwordForm.input.password}
                  password
                  autoComplete="new-password"
                />
                <Control
                  label={tr("auth.reset.confirmPassword", {
                    default: "Confirm password",
                  })}
                  input={passwordForm.input.confirmPassword}
                  password
                  autoComplete="new-password"
                />
                <Button type="submit" loading={passwordSubmitting}>
                  {tr("auth.reset.setPassword", {
                    default: "Set new password",
                  })}
                </Button>
              </form>
            ) : (
              <>
                <Alert>
                  <CheckCircle2 className="size-4" />
                  <AlertDescription>
                    {tr("auth.reset.success", {
                      default: "Your password has been reset successfully.",
                    })}
                  </AlertDescription>
                </Alert>
                <Button
                  render={
                    <a
                      href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
                    />
                  }
                >
                  {tr("auth.reset.backToSignIn", {
                    default: "Back to sign in",
                  })}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<a href={redirect} />}
        >
          {tr("auth.reset.cancel", { default: "Cancel" })}
        </Button>
      </div>
    </div>
  );
}
