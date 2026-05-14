import { TypeBoxError, t } from "alepha";
import type {
  RealmConfig,
  RegistrationIntentResponse,
  UserController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { AlertCircle, Check, Info, X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Control } from "@alepha/ui/components/control/control";
import { iconFor } from "@alepha/ui/components/control-base/icon-hint";

/**
 * Cloudflare Turnstile loader — idempotent across remounts.
 * Resolves once the global `window.turnstile` is ready.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let turnstileLoader: Promise<void> | undefined;
const loadTurnstile = (): Promise<void> => {
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => {
        turnstileLoader = undefined;
        reject(new Error("Turnstile script failed to load"));
      });
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.dataset.turnstile = "1";
    s.onload = () => resolve();
    s.onerror = () => {
      turnstileLoader = undefined;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return turnstileLoader;
};

export interface AuthRegisterProps {
  /**
   * Realm configuration (drives required fields, verification step, OAuth buttons).
   */
  realmConfig: RealmConfig;
  /**
   * Route to the login page. When set, a "Sign in" link is shown.
   */
  loginPath?: string;
  /**
   * Optional banner rendered above the registration form (form phase only).
   * Used to contextualize the flow when the user arrives via a CTA, e.g.
   * "Before creating a campaign, create an account."
   */
  message?: ReactNode;
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

  const captchaSiteKey = props.realmConfig.captchaSiteKey;
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const captchaRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  // The `useForm` handler is memoized at form-create time, so it closes over
  // the *initial* `captchaToken` (undefined). Mirror the latest value into a
  // ref the handler can read at submission time.
  const captchaTokenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    captchaTokenRef.current = captchaToken;
  }, [captchaToken]);

  useEffect(() => {
    if (!captchaSiteKey || state.phase !== "form") return;
    const el = captchaRef.current;
    if (!el) return;
    setCaptchaToken(undefined);
    let disposed = false;
    loadTurnstile()
      .then(() => {
        if (disposed || !window.turnstile || !el) return;
        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: captchaSiteKey,
          theme: "auto",
          callback: (token) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(undefined),
          "error-callback": () => setCaptchaToken(undefined),
        });
      })
      .catch(() => setCaptchaToken(undefined));
    return () => {
      disposed = true;
      const id = widgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {}
      }
      widgetIdRef.current = undefined;
    };
  }, [captchaSiteKey, state.phase]);

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
      password: t.string({
        minLength: settings.passwordPolicy?.minLength ?? 8,
      }),
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
      try {
        const intent = await userCtrl.createRegistrationIntent({
          query: { userRealmName: props.realmConfig.realmName },
          body: {
            username: data.username,
            email: data.email,
            phoneNumber: data.phoneNumber,
            password: data.password,
            captchaToken: captchaSiteKey ? captchaTokenRef.current : undefined,
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
      } catch (err) {
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {}
        }
        setCaptchaToken(undefined);
        throw err;
      }
    },
  });

  const formState = useFormState(form, ["error", "values"]);
  const formError =
    formState.error && !(formState.error instanceof TypeBoxError)
      ? formState.error.message
      : undefined;
  const passwordValue = String(formState.values?.password ?? "");

  const firstFieldId =
    (settings.username !== "none" &&
      settings.username !== "email" &&
      form.input.username?.props.id) ||
    (settings.email !== "none" && form.input.email?.props.id) ||
    (settings.phoneNumber !== "none" && form.input.phoneNumber?.props.id) ||
    form.input.password.props.id;

  useEffect(() => {
    if (state.phase !== "form" || !firstFieldId) return;
    const el = document.getElementById(
      String(firstFieldId),
    ) as HTMLInputElement | null;
    el?.focus();
  }, [state.phase, firstFieldId]);

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

  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (m) => m.type !== "CREDENTIALS",
  );
  const showDivider = credentialsProvider && externalMethods.length > 0;
  const isVerifying = state.phase === "verification" && state.intent;
  const canSubmitVerify =
    !isVerifying ||
    ((!state.intent!.expectEmailVerification || emailCode.length === 6) &&
      (!state.intent!.expectPhoneVerification || phoneCode.length === 6));

  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setContentHeight(el.scrollHeight);
    const ro = new ResizeObserver(() => {
      setContentHeight(el.scrollHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Centered>
      <RealmLogo settings={settings} realmName={props.realmConfig.realmName} />
      <Card className="w-full">
        <CardContent
          className="overflow-hidden p-0 transition-[height] duration-300 ease-out"
          style={
            contentHeight !== undefined ? { height: contentHeight } : undefined
          }
        >
          <div ref={contentRef}>
            <div
              key={state.phase}
              className="animate-in fade-in duration-300 flex flex-col gap-4 px-6"
            >
              {isVerifying ? (
                <>
                  <h2 className="text-center text-lg font-semibold">
                    {tr("auth.register.verifyTitle", {
                      default: "Verify your account",
                    })}
                  </h2>
                  <p className="text-muted-foreground text-center text-sm">
                    {tr("auth.register.verifyHint", {
                      default:
                        "Please enter the verification code(s) sent to you.",
                    })}
                  </p>
                  {verifyError && (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" />
                      <AlertDescription>{verifyError}</AlertDescription>
                    </Alert>
                  )}
                  {state.intent!.expectEmailVerification && (
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
                        autoFocus
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
                  {state.intent!.expectPhoneVerification && (
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
                        autoFocus={!state.intent!.expectEmailVerification}
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
                  <Button
                    onClick={handleVerify}
                    disabled={!canSubmitVerify || submitting}
                  >
                    {tr("auth.register.verifySubmit", {
                      default: "Complete registration",
                    })}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setState({ phase: "form" })}
                  >
                    {tr("auth.register.verifyBack", {
                      default: "Back to registration",
                    })}
                  </Button>
                </>
              ) : (
                <FormPhase
                  allowed={allowed}
                  form={form}
                  formError={formError}
                  passwordValue={passwordValue}
                  settings={settings}
                  realmName={props.realmConfig.realmName}
                  credentialsProvider={credentialsProvider}
                  externalMethods={externalMethods}
                  showDivider={showDivider}
                  redirect={redirect}
                  loginPath={props.loginPath}
                  realmQuery={realmQuery}
                  auth={auth}
                  captchaSiteKey={captchaSiteKey}
                  captchaToken={captchaToken}
                  captchaRef={captchaRef}
                  message={props.message}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {!isVerifying && (
        <Button variant="ghost" asChild>
          <a href={redirect}>
            {tr("auth.register.cancel", { default: "Cancel" })}
          </a>
        </Button>
      )}
    </Centered>
  );
}

function FormPhase(props: {
  allowed: boolean;
  form: ReturnType<typeof useForm>;
  formError: string | undefined;
  passwordValue: string;
  settings: RealmConfig["settings"];
  realmName: string;
  credentialsProvider: any;
  externalMethods: Array<{ name: string; type: string }>;
  showDivider: boolean | undefined;
  redirect: string;
  loginPath: string | undefined;
  realmQuery: string;
  auth: ReturnType<typeof useAuth>;
  captchaSiteKey?: string;
  captchaToken?: string;
  captchaRef: React.RefObject<HTMLDivElement | null>;
  message?: ReactNode;
}) {
  const { tr } = useI18n();
  const [passwordFieldFocused, setPasswordFieldFocused] = useState(false);
  const {
    allowed,
    form,
    formError,
    passwordValue,
    settings,
    credentialsProvider,
    externalMethods,
    showDivider,
    redirect,
    realmQuery,
  } = props;
  return (
    <>
      <RealmHeader settings={settings} realmName={props.realmName} />
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
              {tr("auth.register.backToSignIn", { default: "Back to sign in" })}
            </a>
          </Button>
        </>
      ) : (
        <>
          {props.message && (
            <Alert>
              <Info className="size-4" />
              <AlertDescription>{props.message}</AlertDescription>
            </Alert>
          )}
          {formError && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {credentialsProvider && (
            <form {...form.props} className="flex flex-col gap-4">
              {settings.username !== "none" &&
                settings.username !== "email" &&
                form.input.username && (
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
                  description={
                    settings.verifyEmailRequired
                      ? tr("auth.register.email.verify", {
                          default:
                            "We'll send a verification code to confirm your email.",
                        })
                      : undefined
                  }
                  input={form.input.email}
                  icon={iconFor("email")}
                />
              )}
              {settings.phoneNumber !== "none" && form.input.phoneNumber && (
                <Control
                  label={tr("auth.register.phone", {
                    default: "Phone number",
                  })}
                  description={
                    settings.verifyPhoneRequired
                      ? tr("auth.register.phone.verify", {
                          default:
                            "We'll send a verification code to confirm your phone number.",
                        })
                      : undefined
                  }
                  input={form.input.phoneNumber}
                  icon={iconFor("phone")}
                />
              )}
              {/* `onFocus`/`onBlur` bubble from the input + toggle inside —
                  the rules stay visible while the user types or interacts
                  with the password toggle, and only collapse once the field
                  is blurred AND empty. */}
              <div
                onFocus={() => setPasswordFieldFocused(true)}
                onBlur={() => setPasswordFieldFocused(false)}
              >
                <Control
                  label={tr("auth.register.password", { default: "Password" })}
                  input={form.input.password}
                  password
                />
              </div>
              {(passwordFieldFocused || passwordValue.length > 0) && (
                <PasswordRules
                  policy={settings.passwordPolicy}
                  value={passwordValue}
                />
              )}
              {props.captchaSiteKey && (
                <div
                  ref={props.captchaRef}
                  data-testid="captcha"
                  className="flex justify-center"
                />
              )}
              <Button
                type="submit"
                disabled={
                  form.submitting ||
                  (!!props.captchaSiteKey && !props.captchaToken)
                }
              >
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
                  props.auth.login(method.name as never, {
                    redirect,
                    realm: props.realmName,
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
    </>
  );
}

function Centered(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
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
  if (!s.displayName && !s.description) return null;
  return (
    <div className="flex flex-col items-center gap-1">
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

function PasswordRules(props: {
  policy: RealmConfig["settings"]["passwordPolicy"];
  value: string;
}) {
  const { tr } = useI18n();
  const policy = props.policy;
  const value = props.value;

  const rules: { ok: boolean; label: string }[] = [];

  if (policy?.minLength && policy.minLength > 0) {
    rules.push({
      ok: value.length >= policy.minLength,
      label: tr("auth.register.password.rule.minLength", {
        default: `At least ${policy.minLength} characters`,
        args: [String(policy.minLength)],
      }),
    });
  }
  if (policy?.requireUppercase) {
    rules.push({
      ok: /[A-Z]/.test(value),
      label: tr("auth.register.password.rule.uppercase", {
        default: "One uppercase letter",
      }),
    });
  }
  if (policy?.requireLowercase) {
    rules.push({
      ok: /[a-z]/.test(value),
      label: tr("auth.register.password.rule.lowercase", {
        default: "One lowercase letter",
      }),
    });
  }
  if (policy?.requireNumbers) {
    rules.push({
      ok: /[0-9]/.test(value),
      label: tr("auth.register.password.rule.number", {
        default: "One number",
      }),
    });
  }
  if (policy?.requireSpecialCharacters) {
    rules.push({
      ok: /[^A-Za-z0-9]/.test(value),
      label: tr("auth.register.password.rule.special", {
        default: "One special character",
      }),
    });
  }

  if (rules.length === 0) return null;

  return (
    <ul className="text-muted-foreground -mt-2 flex flex-col gap-1 text-xs">
      {rules.map((rule, idx) => (
        <li
          key={idx}
          className={`flex items-center gap-1.5 ${rule.ok ? "text-emerald-600 dark:text-emerald-400" : ""}`}
        >
          {rule.ok ? (
            <Check className="size-3.5" />
          ) : (
            <X className="size-3.5 opacity-50" />
          )}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}

function RealmLogo(props: {
  settings: RealmConfig["settings"];
  realmName: string;
}) {
  if (!props.settings.logoUrl) return null;
  return (
    <img
      src={props.settings.logoUrl}
      alt={props.settings.displayName || props.realmName}
      className="size-16 rounded-xl border bg-muted object-cover shadow-sm"
    />
  );
}
