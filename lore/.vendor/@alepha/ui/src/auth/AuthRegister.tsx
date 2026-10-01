import * as React from "react";

void React;

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
import { AlertCircle } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { Button } from "../core/Button.tsx";
import { Card, CardContent } from "../core/Card.tsx";
import { Label } from "../core/Label.tsx";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "../otp/InputOTP.tsx";
import { AuthRegisterCentered } from "./AuthRegisterCentered.tsx";
import { AuthRegisterFormPhase } from "./AuthRegisterFormPhase.tsx";
import { AuthRegisterRealmLogo } from "./AuthRegisterRealmLogo.tsx";
import { safeRedirect } from "./safeRedirect.ts";
import type { TurnstileWidgetHandle } from "./TurnstileWidget.tsx";

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
  /**
   * Render the form even though `settings.registrationAllowed` is `false`.
   *
   * For a visitor the application has already vouched for out of band - an
   * invitation link, a signup code - who would otherwise meet the closed
   * alert and stop. Presentation only: the server decides, through the
   * realm's `isPreAuthorized` seam, and refuses this submit like any other if
   * {@link preAuthToken} does not hold up.
   */
  preAuthorized?: boolean;
  /**
   * Pre-fill the email field and stop it being edited.
   *
   * Set it alongside {@link preAuthToken}, which is bound to one address:
   * letting the field be typed over only produces a server-side refusal the
   * visitor cannot act on.
   */
  lockedEmail?: string;
  /**
   * The application's opaque proof that this address may register into a
   * closed realm. Passed through to the register request untouched.
   */
  preAuthToken?: string;
  /**
   * Where a successful registration lands, overriding `?redirect=`.
   *
   * A prop rather than a URL param because the submit handler is built ONCE,
   * at mount, and closes over whatever `redirect` was then: a page that
   * decides the destination and seeds the query afterwards has already
   * missed it, and the user lands on the default with nothing to explain
   * why. A prop is read on the render that builds the handler.
   *
   * Sanitised like the query value, since the two are the same kind of thing.
   */
  redirect?: string;
}

export const AuthRegister = (props: AuthRegisterProps) => {
  const auth = useAuth();
  const userCtrl = useClient<UserController>();
  const router = useRouter();
  const { tr } = useI18n();
  const redirect = safeRedirect(props.redirect ?? router.query.redirect);
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
  // The handler reads the token the widget issued last through a ref, so a
  // submit never posts a token captured by an earlier render.
  const captchaTokenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    captchaTokenRef.current = captchaToken;
  }, [captchaToken]);

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const settings = props.realmConfig.settings;
  // The realm decides, unless the application has already vouched for this
  // particular visitor. Both halves are presentation: the gate is
  // `RegistrationService`, which refuses a submit that the seam does not
  // recognise however the form got rendered.
  const allowed =
    props.preAuthorized === true || settings.registrationAllowed !== false;

  const schema = useMemo(() => {
    // Optionality is decided as each field is built, because that is the only
    // thing the form reads: `FormModel` derives both the required marker and
    // the pre-submit check from `z.schema.requiredKeys(schema)`, which asks
    // whether the field is optional or defaulted.
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
    // A locked address is the form's starting value, not a field the visitor
    // fills. It arrives before mount (the page resolves the token in its
    // loader), which is what lets `useForm` anchor it here.
    initialValues: props.lockedEmail
      ? ({ email: props.lockedEmail } as never)
      : undefined,
    // Handled here: every error this form throws is rendered by the page itself,
    // under its field or in the alert above the form. Without an `onError`,
    // a mounted `ActionErrorToaster` toasted the same sentence a second time.
    onError: () => {},
    handler: async (data) => {
      try {
        const intent = await userCtrl.createRegistrationIntent({
          query: { userRealmName: props.realmConfig.realmName },
          body: {
            firstName: data.firstName,
            lastName: data.lastName,
            username: data.username,
            // The locked address wins over whatever the field holds: it is
            // the one the token is bound to, and a disabled input is a
            // presentation fact rather than a guarantee.
            email: props.lockedEmail ?? data.email,
            phoneNumber: data.phoneNumber,
            password: data.password,
            captchaToken: captchaSiteKey ? captchaTokenRef.current : undefined,
            preAuthToken: props.preAuthToken,
          },
        });
        const identifier =
          data.username ?? props.lockedEmail ?? data.email ?? data.phoneNumber;
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
        // authenticated user — see the note in AuthLogin.tsx.
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
      // authenticated user — see the note in AuthLogin.tsx.
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
    <AuthRegisterCentered>
      {props.logo ?? (
        <AuthRegisterRealmLogo
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
              className="animate-in fade-in flex flex-col gap-4 px-6 duration-300"
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
                    variant="minimal"
                    onClick={() => setState({ phase: "form" })}
                  >
                    {tr("auth.register.verifyBack", {
                      default: "Back to registration",
                    })}
                  </Button>
                </>
              ) : (
                <AuthRegisterFormPhase
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
                  lockedEmail={props.lockedEmail}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {!isVerifying && (
        <Button
          variant="minimal"
          nativeButton={false}
          render={<a href={props.cancelPath ?? "/"} />}
        >
          {tr("auth.register.cancel", { default: "Cancel" })}
        </Button>
      )}
    </AuthRegisterCentered>
  );
};

type Phase = "form" | "verification";

interface State {
  phase: Phase;
  intent?: RegistrationIntentResponse;
  credentials?: { identifier: string; password: string };
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
