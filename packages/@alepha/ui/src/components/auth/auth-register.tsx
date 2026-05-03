import { Control } from "@alepha/ui/components/control/control";
import { iconFor } from "@alepha/ui/components/control-base/icon-hint";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@alepha/ui/components/ui/input-otp";
import { Label } from "@alepha/ui/components/ui/label";
import { Separator } from "@alepha/ui/components/ui/separator";
import { AlephaError, t } from "alepha";
import type {
  RealmConfig,
  RegistrationIntentResponse,
  UserController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";

export interface AuthRegisterProps {
  /**
   * Realm configuration (drives required fields, verification step, OAuth buttons).
   */
  realmConfig: RealmConfig;
  /**
   * Route to the login page. When set, a "Sign in" link is shown.
   */
  loginPath?: string;
}

type Phase = "form" | "verification";

interface State {
  phase: Phase;
  intent?: RegistrationIntentResponse;
  credentials?: { identifier: string; password: string };
}

export function AuthRegister(props: AuthRegisterProps) {
  const auth = useAuth();
  const userCtrl = useClient<UserController>();
  const router = useRouter();
  const { tr } = useI18n();
  const redirect = router.query.r || "/";

  const [state, setState] = useState<State>({ phase: "form" });
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const settings = props.realmConfig.settings;
  const allowed = settings.registrationAllowed !== false;

  const schema = useMemo(() => {
    const s = t.object({
      username: t.optional(
        t.text({ trim: true, pattern: settings.usernameRegExp }),
      ),
      email: t.optional(t.email()),
      phoneNumber: t.optional(t.e164()),
      password: t.string({ minLength: 8 }),
      confirmPassword: t.string({ minLength: 8 }),
    });
    const required = s.required as string[];
    if (settings.username === "required") required.push("username");
    if (settings.email === "required") required.push("email");
    if (settings.phoneNumber === "required") required.push("phoneNumber");
    return s;
  }, [settings]);

  const form = useForm({
    schema,
    handler: async (data) => {
      if (data.password !== data.confirmPassword) {
        throw new AlephaError(
          tr("auth.register.passwordsMismatch", {
            default: "Passwords do not match",
          }),
        );
      }
      const intent = await userCtrl.createRegistrationIntent({
        query: { userRealmName: props.realmConfig.realmName },
        body: {
          username: data.username,
          email: data.email,
          phoneNumber: data.phoneNumber,
          password: data.password,
        },
      });
      const identifier = data.username ?? data.email ?? data.phoneNumber;
      if (
        intent.expectEmailVerification ||
        intent.expectPhoneVerification ||
        intent.expectCaptcha
      ) {
        setState({
          phase: "verification",
          intent,
          credentials: identifier
            ? { identifier, password: data.password }
            : undefined,
        });
        return;
      }
      await userCtrl.createUserFromIntent({
        body: { intentId: intent.intentId },
      });
      if (identifier && credentialsProvider) {
        await auth.login(credentialsProvider.name, {
          username: identifier,
          password: data.password,
          realm: props.realmConfig.realmName,
        });
      }
      await router.push(redirect);
    },
  });

  const handleVerify = async () => {
    if (!state.intent) return;
    setSubmitting(true);
    setVerifyError(null);
    try {
      await userCtrl.createUserFromIntent({
        body: {
          intentId: state.intent.intentId,
          emailCode: state.intent.expectEmailVerification
            ? emailCode
            : undefined,
          phoneCode: state.intent.expectPhoneVerification
            ? phoneCode
            : undefined,
        },
      });
      if (state.credentials && credentialsProvider) {
        await auth.login(credentialsProvider.name, {
          username: state.credentials.identifier,
          password: state.credentials.password,
          realm: props.realmConfig.realmName,
        });
      }
      await router.push(redirect);
    } catch (err) {
      setVerifyError(
        err instanceof Error
          ? err.message
          : tr("auth.register.verifyFailed", {
              default: "Verification failed",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";

  if (state.phase === "verification" && state.intent) {
    const canSubmit =
      (!state.intent.expectEmailVerification || emailCode.length === 6) &&
      (!state.intent.expectPhoneVerification || phoneCode.length === 6);
    return (
      <Centered>
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <h2 className="text-center text-lg font-semibold">
              {tr("auth.register.verifyTitle", {
                default: "Verify your account",
              })}
            </h2>
            <p className="text-muted-foreground text-center text-sm">
              {tr("auth.register.verifyHint", {
                default: "Please enter the verification code(s) sent to you.",
              })}
            </p>
            {verifyError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{verifyError}</AlertDescription>
              </Alert>
            )}
            {state.intent.expectEmailVerification && (
              <div className="flex flex-col items-center gap-2">
                <Label htmlFor="emailCode">
                  {tr("auth.register.emailCode", {
                    default: "Email verification code",
                  })}
                </Label>
                <InputOTP
                  id="emailCode"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={emailCode}
                  onChange={setEmailCode}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            )}
            {state.intent.expectPhoneVerification && (
              <div className="flex flex-col items-center gap-2">
                <Label htmlFor="phoneCode">
                  {tr("auth.register.phoneCode", {
                    default: "Phone verification code",
                  })}
                </Label>
                <InputOTP
                  id="phoneCode"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={phoneCode}
                  onChange={setPhoneCode}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            )}
            <Button onClick={handleVerify} disabled={!canSubmit || submitting}>
              {tr("auth.register.verifySubmit", {
                default: "Complete registration",
              })}
            </Button>
            <Button variant="ghost" onClick={() => setState({ phase: "form" })}>
              {tr("auth.register.verifyBack", {
                default: "Back to registration",
              })}
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (m) => m.type !== "CREDENTIALS",
  );
  const showDivider = credentialsProvider && externalMethods.length > 0;

  return (
    <Centered>
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <RealmHeader
            settings={settings}
            realmName={props.realmConfig.realmName}
          />
          {!allowed ? (
            <>
              <Alert>
                <AlertCircle className="size-4" />
                <AlertDescription>
                  {tr("auth.register.disabled", {
                    default:
                      "Registration is not available. Please contact your administrator.",
                  })}
                </AlertDescription>
              </Alert>
              <Button asChild>
                <a href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}>
                  {tr("auth.register.backToSignIn", {
                    default: "Back to sign in",
                  })}
                </a>
              </Button>
            </>
          ) : (
            <>
              {credentialsProvider && (
                <form {...form.props} className="flex flex-col gap-4">
                  {settings.username !== "none" && form.input.username && (
                    <Control
                      label={tr("auth.register.username", {
                        default: "Username",
                      })}
                      input={form.input.username}
                      icon={iconFor("user")}
                    />
                  )}
                  {settings.email !== "none" && form.input.email && (
                    <Control
                      label={tr("auth.register.email", { default: "Email" })}
                      input={form.input.email}
                      icon={iconFor("email")}
                    />
                  )}
                  {settings.phoneNumber !== "none" &&
                    form.input.phoneNumber && (
                      <Control
                        label={tr("auth.register.phone", {
                          default: "Phone number",
                        })}
                        input={form.input.phoneNumber}
                        icon={iconFor("phone")}
                      />
                    )}
                  <Control
                    label={tr("auth.register.password", {
                      default: "Password",
                    })}
                    input={form.input.password}
                    password
                  />
                  <Control
                    label={tr("auth.register.confirmPassword", {
                      default: "Confirm password",
                    })}
                    input={form.input.confirmPassword}
                    password
                  />
                  <Button type="submit" disabled={form.submitting}>
                    {tr("auth.register.submit", { default: "Create account" })}
                  </Button>
                </form>
              )}
              {showDivider && (
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground text-xs">
                    {tr("auth.register.or", { default: "OR" })}
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}
              {externalMethods.map((method) => {
                const provider =
                  method.name.charAt(0).toUpperCase() + method.name.slice(1);
                return (
                  <Button
                    key={method.name}
                    variant="outline"
                    onClick={() =>
                      auth.login(method.name, {
                        redirect,
                        realm: props.realmConfig.realmName,
                      })
                    }
                  >
                    {tr("auth.register.continueWith", {
                      default: `Continue with ${provider}`,
                      args: [provider],
                    })}
                  </Button>
                );
              })}
              <p className="text-muted-foreground text-center text-sm">
                {tr("auth.register.haveAccount", {
                  default: "Already have an account?",
                })}{" "}
                <a
                  href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {tr("auth.register.signIn", { default: "Sign in" })}
                </a>
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <Button variant="ghost" asChild>
        <a href={redirect}>
          {tr("auth.register.cancel", { default: "Cancel" })}
        </a>
      </Button>
    </Centered>
  );
}

function Centered(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {props.children}
      </div>
    </div>
  );
}

function RealmHeader(props: {
  settings: RealmConfig["settings"];
  realmName: string;
}) {
  const s = props.settings;
  if (!s.logoUrl && !s.displayName && !s.description) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      {s.logoUrl && (
        <img
          src={s.logoUrl}
          alt={s.displayName || props.realmName}
          className="h-12 w-auto object-contain"
        />
      )}
      {s.displayName && (
        <h2 className="text-center text-lg font-semibold">{s.displayName}</h2>
      )}
      {s.description && (
        <p className="text-muted-foreground text-center text-sm">
          {s.description}
        </p>
      )}
    </div>
  );
}
