import * as React from "react";

void React;

import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
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
  InputOTPSeparator,
  InputOTPSlot,
} from "@alepha/ui/components/ui/input-otp";
import { Label } from "@alepha/ui/components/ui/label";
import { Separator } from "@alepha/ui/components/ui/separator";
import { SchemaValidationError, z } from "alepha";
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

export interface AuthRegisterProps {
  /**
   * Realm configuration (drives required fields, verification step, OAuth buttons).
   */
  realmConfig: RealmConfig;
  /**
   * Custom logo node, rendered above the form. When provided, it replaces
   * the default `settings.logoUrl` <img>. Use this to inject a branded
   * component (e.g. with light/dark variants or an animation).
   */
  logo?: ReactNode;
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
  /**
   * Where the "Cancel" button abandons to. Defaults to "/". This is
   * intentionally decoupled from the post-auth `?redirect=` target: cancelling
   * an unauthenticated registration must land somewhere public (home), not the
   * protected destination the user was *heading* to — which would only bounce
   * them back to this page.
   */
  cancelPath?: string;
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
  const redirect = router.query.redirect || "/";
  // Surface upstream auth errors (e.g. failed OAuth callback redirects with
  // `?error=...`) — same pattern as AuthLogin. Without this the user lands on
  // a fresh-looking registration page with no clue why.
  const queryError =
    typeof router.query.error === "string" ? router.query.error : undefined;

  const [state, setState] = useState<State>({ phase: "form" });
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const captchaSiteKey = props.realmConfig.captchaSiteKey;
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const captchaRef = useRef<TurnstileWidgetHandle | null>(null);
  // The `useForm` handler is memoized at form-create time, so it closes over
  // the *initial* `captchaToken` (undefined). Mirror the latest value into a
  // ref the handler can read at submission time.
  const captchaTokenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    captchaTokenRef.current = captchaToken;
  }, [captchaToken]);

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const settings = props.realmConfig.settings;
  const allowed = settings.registrationAllowed !== false;

  const schema = useMemo(() => {
    // Optionality is decided as each field is built, because that is the only
    // thing the form reads: `FormModel` derives both the required marker and
    // the pre-submit check from `z.schema.requiredKeys(schema)`, which asks
    // whether the field is a `ZodOptional`.
    //
    // This used to declare every field optional and then push the configured
    // names onto the array returned by `z.schema.requiredKeys(s)` — a TypeBox
    // habit, where a JSON Schema's `required` was a live array hanging off the
    // schema. The zod implementation computes a fresh array from the shape, so
    // the pushes mutated a detached value and vanished: a realm with
    // `email: "required"` still rendered Email with no asterisk and let an
    // empty one through to the server.
    const names = settings.firstNameLastName === "required";
    const shape = {
      firstName: names
        ? z.text({ trim: true, maxLength: 100 })
        : z.text({ trim: true, maxLength: 100 }).optional(),
      lastName: names
        ? z.text({ trim: true, maxLength: 100 })
        : z.text({ trim: true, maxLength: 100 }).optional(),
      username:
        settings.username === "required"
          ? z.text({ trim: true, pattern: settings.usernameRegExp })
          : z.text({ trim: true, pattern: settings.usernameRegExp }).optional(),
      email: settings.email === "required" ? z.email() : z.email().optional(),
      phoneNumber:
        settings.phoneNumber === "required" ? z.e164() : z.e164().optional(),
      password: z.string().min(settings.passwordPolicy?.minLength ?? 8),
    };

    // The runtime shape varies with the realm, but the *type* must not: every
    // consumer below reads `data.email`, `data.username` and the rest as
    // possibly-absent. Widening to the all-optional shape keeps one stable
    // type instead of a union of eight.
    return z.object(shape) as unknown as ReturnType<typeof registerFormSchema>;
  }, [settings]);

  const form = useForm({
    schema,
    handler: async (data) => {
      try {
        const intent = await userCtrl.createRegistrationIntent({
          query: { userRealmName: props.realmConfig.realmName },
          body: {
            firstName: data.firstName,
            lastName: data.lastName,
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
        // `force: true` so parent-layout loaders re-run against the freshly
        // authenticated user — see the note in auth-login.tsx.
        await router.push(redirect, { force: true });
      } catch (err) {
        // Turnstile tokens are single-use — force a fresh challenge so the
        // user can retry after a server-side failure.
        captchaRef.current?.reset();
        throw err;
      }
    },
  });

  const formState = useFormState(form, ["error", "values", "loading"]);
  const formError =
    formState.error && !(formState.error instanceof SchemaValidationError)
      ? formState.error.message
      : undefined;
  const passwordValue = String(formState.values?.password ?? "");

  const firstFieldId =
    (settings.firstNameLastName !== "none" && form.input.firstName?.props.id) ||
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
      // `force: true` so parent-layout loaders re-run against the freshly
      // authenticated user — see the note in auth-login.tsx.
      await router.push(redirect, { force: true });
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

  // Query appended to the "already have an account? sign in" link: the realm,
  // plus the post-auth redirect (`?redirect=`) so signing in returns the user
  // to wherever registering would have sent them (it's dropped otherwise).
  const realmBit = props.realmConfig.realmName
    ? `realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";
  const redirectBit =
    typeof router.query.redirect === "string" && router.query.redirect
      ? `redirect=${encodeURIComponent(router.query.redirect)}`
      : "";
  const loginQ = [realmBit, redirectBit].filter(Boolean).join("&");
  const realmQuery = loginQ ? `?${loginQ}` : "";

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
      {props.logo ?? (
        <RealmLogo
          settings={settings}
          realmName={props.realmConfig.realmName}
        />
      )}
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
                    loading={submitting}
                    disabled={!canSubmitVerify}
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
                  formError={formError ?? queryError}
                  loading={formState.loading}
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
                  onCaptchaToken={setCaptchaToken}
                  message={props.message}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {!isVerifying && (
        <Button
          variant="ghost"
          nativeButton={false}
          render={<a href={props.cancelPath ?? "/"} />}
        >
          {tr("auth.register.cancel", { default: "Cancel" })}
        </Button>
      )}
    </Centered>
  );
}

function FormPhase(props: {
  allowed: boolean;
  form: ReturnType<typeof useForm>;
  formError: string | undefined;
  loading: boolean;
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
  captchaRef: React.RefObject<TurnstileWidgetHandle | null>;
  onCaptchaToken: (token: string | undefined) => void;
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
          <Button
            render={
              <a href={`${props.loginPath ?? "/auth/login"}${realmQuery}`} />
            }
          >
            {tr("auth.register.backToSignIn", { default: "Back to sign in" })}
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
              {settings.firstNameLastName !== "none" &&
                form.input.firstName &&
                form.input.lastName && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Control
                      label={tr("auth.register.firstName", {
                        default: "First name",
                      })}
                      input={form.input.firstName}
                      autoComplete="given-name"
                    />
                    <Control
                      label={tr("auth.register.lastName", {
                        default: "Last name",
                      })}
                      input={form.input.lastName}
                      autoComplete="family-name"
                    />
                  </div>
                )}
              {settings.username !== "none" &&
                settings.username !== "email" &&
                form.input.username && (
                  <Control
                    label={tr("auth.register.username", {
                      default: "Username",
                    })}
                    input={form.input.username}
                    icon={iconFor("user")}
                    autoComplete="username"
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
                  autoComplete="new-password"
                />
              </div>
              {(passwordFieldFocused || passwordValue.length > 0) && (
                <PasswordRules
                  policy={settings.passwordPolicy}
                  value={passwordValue}
                />
              )}
              {props.captchaSiteKey && (
                <TurnstileWidget
                  ref={props.captchaRef}
                  siteKey={props.captchaSiteKey}
                  onToken={props.onCaptchaToken}
                  className="flex justify-center"
                />
              )}
              <Button
                type="submit"
                loading={props.loading}
                disabled={!!props.captchaSiteKey && !props.captchaToken}
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
                <BrandIcon provider={method.name} />
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

/**
 * The reference shape of the registration form, with every configurable field
 * optional.
 *
 * `AuthRegister` builds its real schema from the realm settings, so which
 * fields are optional changes per realm. This exists purely to give that
 * schema one stable TypeScript type: the handler reads `data.email`,
 * `data.username` and `data.phoneNumber` as possibly-absent regardless of what
 * a given realm requires, which is the correct type for code that has to
 * compile against all of them.
 */
const registerFormSchema = () =>
  z.object({
    firstName: z.text({ trim: true, maxLength: 100 }).optional(),
    lastName: z.text({ trim: true, maxLength: 100 }).optional(),
    username: z.text({ trim: true }).optional(),
    email: z.email().optional(),
    phoneNumber: z.e164().optional(),
    password: z.string(),
  });
