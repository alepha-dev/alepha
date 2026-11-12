import * as React from "react";

void React;

import { AlephaError, SchemaValidationError, z } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useInject } from "alepha/react";
import {
  type MfaChallenge,
  MfaRequiredError,
  PasskeyClient,
  useAuth,
} from "alepha/react/auth";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError, isHttpError } from "alepha/server";
import { AlertCircle, Fingerprint, Mail, User } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { BrandIcon } from "../core/BrandIcon.tsx";
import { Button } from "../core/Button.tsx";
import { Card, CardContent } from "../core/Card.tsx";
import { Separator } from "../core/Separator.tsx";
import { Control } from "../form/Control.tsx";
import { AuthMfaStep } from "./AuthMfaStep.tsx";
import { AuthPasskeyAutofill } from "./AuthPasskeyAutofill.tsx";
import { safeRedirect } from "./safeRedirect.ts";

export interface AuthLoginProps {
  /**
   * Realm configuration (credential providers + OAuth buttons that render).
   */
  realmConfig: RealmConfig;
  /**
   * Route to the registration page. When set, a "Sign up" link is shown.
   */
  registerPath?: string;
  /**
   * Route to the password-reset flow. When set, a "Forgot password?" link is shown.
   */
  resetPasswordPath?: string;
  /**
   * Layout variant.
   * - `centered` (default): single column, form centered on the viewport.
   * - `split`: two-pane on `lg`+ — branded background panel on the left, form on the right. Collapses to centered on small screens.
   */
  variant?: "centered" | "split";
  /**
   * Background panel configuration for the `split` variant. Ignored for `centered`.
   * - `src`: image URL. When omitted, a neutral dot pattern is rendered.
   * - `overlay`: optional content drawn over the background (logo, tagline).
   */
  background?: {
    src?: string;
    overlay?: ReactNode;
  };
  /**
   * Custom logo node, rendered above the form. When provided, it replaces
   * the default `settings.logoUrl` <img>. Use this to inject a branded
   * component (e.g. with light/dark variants or an animation).
   */
  logo?: ReactNode;
  /**
   * Where the "Cancel" link under the form leads. Defaults to "/".
   *
   * Pass `false` to hide the link, for an application where every page
   * needs an account: there "/" only leads back to this page. It is
   * intentionally decoupled from the post-auth `?redirect=` target, which is
   * a protected destination the visitor has not reached yet.
   */
  cancelPath?: string | false;
}

export const AuthLogin = (props: AuthLoginProps) => {
  const auth = useAuth();
  const router = useRouter<any>();
  const { tr } = useI18n();
  const redirect = safeRedirect(router.query.redirect);
  const error = router.query.error;

  /**
   * Set once the password has been accepted and a second factor is owed.
   * While it is set, the code step replaces the credentials form.
   */
  const [challenge, setChallenge] = useState<MfaChallenge>();

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const settings = props.realmConfig.settings;

  const loginMethods = useMemo(() => {
    const methods: string[] = [];
    // `username: "email"` means the username is auto-derived from the email
    // server-side and never typed by the user — it's not a separate login
    // method from the user's perspective.
    if (settings.username !== "none" && settings.username !== "email") {
      methods.push("username");
    }
    if (settings.email !== "none") methods.push("email");
    if (settings.phoneNumber !== "none") methods.push("phone");
    return methods;
  }, [settings]);

  const identifierLabel = useMemo(() => {
    if (loginMethods.length <= 1) {
      const m = loginMethods[0];
      if (m === "email") return tr("auth.login.email", { default: "Email" });
      if (m === "phone")
        return tr("auth.login.phone", { default: "Phone number" });
      return tr("auth.login.username", { default: "Username" });
    }
    return tr("auth.login.identifier", {
      default: "Username, email or phone",
    });
  }, [loginMethods, tr]);

  // Mail icon when the identifier is purely an email; otherwise default user icon.
  const identifierIcon =
    loginMethods.length === 1 && loginMethods[0] === "email" ? Mail : User;

  // Pick the most-precise HTML autocomplete hint so password managers and
  // browser autofill (especially iOS Keychain) pair the identifier with the
  // saved password reliably. Mixed configs fall back to `username` — the
  // WHATWG-canonical hint for "the account identifier".
  const baseAutoComplete =
    loginMethods.length === 1
      ? loginMethods[0] === "email"
        ? "email"
        : loginMethods[0] === "phone"
          ? "tel"
          : "username"
      : "username";

  // Passkeys, when the realm offers them and the browser can use them: a
  // button under the form, and the identifier's autofill. `webauthn` is
  // appended to the computed hint, never in its place.
  const passkeyClient = useInject(PasskeyClient);
  const passkeysOffered =
    settings.passkeys === "optional" && passkeyClient.isSupported();
  const identifierAutoComplete = passkeysOffered
    ? `${baseAutoComplete} webauthn`
    : baseAutoComplete;
  const autofillRef = useRef<AbortController | undefined>(undefined);
  const [autofillGeneration, setAutofillGeneration] = useState(0);
  const [passkeyError, setPasskeyError] = useState<string>();
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const afterPasskey = async () => {
    await router.push(safeRedirect(router.query.redirect), { force: true });
  };

  // One wording for a refused passkey, whichever ceremony reported it: the
  // button's or the identifier's autofill, which can settle first.
  const passkeyErrorMessage = (err: unknown): string =>
    isHttpError(err, 401)
      ? tr("auth.login.passkeyInvalid", {
          default: "That passkey could not sign you in.",
        })
      : err instanceof Error
        ? err.message
        : String(err);

  const signInWithPasskey = async () => {
    // Two concurrent `get` calls throw: the autofill one goes first.
    autofillRef.current?.abort();
    setPasskeyBusy(true);
    setPasskeyError(undefined);
    try {
      const tokens = await auth.loginPasskey({
        realm: props.realmConfig.realmName,
      });
      if (tokens) {
        await afterPasskey();
        return;
      }
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setChallenge(err.data);
        return;
      }
      setPasskeyError(passkeyErrorMessage(err));
    } finally {
      setPasskeyBusy(false);
    }
    setAutofillGeneration((it) => it + 1);
  };

  const form = useForm({
    schema: z.object({
      identifier: z.string().min(1),
      password: z.string().min(settings.passwordPolicy?.minLength || 6),
    }),
    // Handled here: every error this form throws is rendered by the page itself,
    // under its field or in the alert above the form. Without an `onError`,
    // a mounted `ActionErrorToaster` toasted the same sentence a second time.
    onError: () => {},
    handler: async (data) => {
      if (!credentialsProvider) {
        throw new AlephaError("Credentials provider not configured");
      }
      try {
        await auth.login(credentialsProvider.name, {
          username: data.identifier,
          password: data.password,
          realm: props.realmConfig.realmName,
        });
        // `force: true` recreates the whole page state so every parent-layout
        // loader re-runs against the now-authenticated user. Without it, an
        // SPA push to a sibling under the same layout reuses the cached layout
        // layer and skips its loader — leaving `user`-gated bootstrap data
        // (e.g. the campaign list) stale/empty after sign-in.
        await router.push(safeRedirect(router.query.redirect), {
          force: true,
        });
      } catch (err) {
        // The password was right and the realm wants a second factor. Not a
        // failure: swap the form for the code step and carry on.
        if (err instanceof MfaRequiredError) {
          setChallenge(err.data);
          return;
        }
        // A 401 from the password grant is a refused password. Matched on the
        // status rather than on `INVALID_CREDENTIALS`, so any refusal of the
        // grant lands on the password field instead of the alert.
        if (isHttpError(err, 401)) {
          throw new FormValidationError({
            message: tr("auth.login.invalid", {
              default: "Invalid identifier or password",
            }),
            path: "/password",
          });
        }
        // Other 4xx are intentional, user-facing API errors — surface as-is.
        if (err instanceof HttpError && err.status < 500) {
          throw err;
        }
        // 5xx / unexpected: never show internals to the user. Log the real
        // cause and surface a generic message.
        console.error("Login failed:", err);
        throw new FormValidationError({
          message: tr("auth.login.error", {
            default: "Something went wrong. Please try again.",
          }),
          path: "/password",
        });
      }
    },
  });

  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (m) => m.type !== "CREDENTIALS",
  );

  // Autofocus the identifier field on mount - but only when credentials is the
  // *sole* login method. With OAuth/external buttons present we don't steal
  // focus (and trigger the browser's autofill popup) from a user who came to
  // click "Continue with ...".
  const autoFocusIdentifier = !!credentialsProvider && !externalMethods.length;

  const formState = useFormState(form, ["error", "loading"]);
  const formError =
    formState.error && !(formState.error instanceof SchemaValidationError)
      ? formState.error.message
      : undefined;
  const showDivider =
    !challenge && credentialsProvider && externalMethods.length > 0;
  // Propagate BOTH realm and the post-auth redirect to the register / reset
  // links — dropping `redirect` here strands a user who signs up mid-flow
  // (e.g. an OIDC authorize continuation) on the home page. Mirrors the
  // login-link construction in auth-register.
  const realmBit = props.realmConfig.realmName
    ? `realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";
  const redirectBit =
    typeof router.query.redirect === "string" && router.query.redirect
      ? `redirect=${encodeURIComponent(router.query.redirect)}`
      : "";
  const linkQ = [realmBit, redirectBit].filter(Boolean).join("&");
  const realmQuery = linkQ ? `?${linkQ}` : "";

  const variant = props.variant ?? "centered";

  const formColumn = (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      {props.logo ??
        (settings.logoUrl ? (
          <img
            src={settings.logoUrl}
            alt={settings.displayName || props.realmConfig.realmName}
            className="bg-muted size-16 rounded-xl border object-cover shadow-sm"
          />
        ) : null)}
      <Card className="w-full">
        <CardContent className="flex flex-col gap-4">
          {(settings.displayName || settings.description) && (
            <div className="flex flex-col items-center gap-1">
              {settings.displayName && (
                <h2 className="text-center text-lg font-semibold">
                  {settings.displayName}
                </h2>
              )}
              {settings.description && (
                <p className="text-muted-foreground text-center text-sm">
                  {settings.description}
                </p>
              )}
            </div>
          )}

          {(error || formError || passkeyError) && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                {error || formError || passkeyError}
              </AlertDescription>
            </Alert>
          )}

          {challenge && (
            <AuthMfaStep
              challenge={challenge}
              onVerified={async () => {
                await router.push(safeRedirect(router.query.redirect), {
                  force: true,
                });
              }}
              onCancel={() => setChallenge(undefined)}
            />
          )}

          {!challenge && credentialsProvider && (
            <form {...form.props} className="flex flex-col gap-4">
              <Control
                label={identifierLabel}
                input={form.input.identifier}
                icon={identifierIcon}
                autoComplete={identifierAutoComplete}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- a caller-requested autofocus, see `autoFocus` in form/Control.tsx
                autoFocus={autoFocusIdentifier}
              />
              <Control
                label={tr("auth.login.password", {
                  default: "Password",
                })}
                input={form.input.password}
                password
              />
              <Button type="submit" loading={formState.loading}>
                {tr("auth.login.submit", { default: "Sign in" })}
              </Button>
              {settings.resetPasswordAllowed && (
                <a
                  href={`${props.resetPasswordPath ?? "/auth/reset-password"}${realmQuery}`}
                  className="text-muted-foreground hover:text-foreground text-center text-sm underline-offset-4 hover:underline"
                >
                  {tr("auth.login.forgot", {
                    default: "Forgot password?",
                  })}
                </a>
              )}
            </form>
          )}

          {!challenge && passkeysOffered && (
            <>
              <AuthPasskeyAutofill
                realm={props.realmConfig.realmName}
                onController={(controller) => {
                  autofillRef.current = controller;
                }}
                generation={autofillGeneration}
                onSignedIn={afterPasskey}
                onError={(err) => setPasskeyError(passkeyErrorMessage(err))}
              />
              <Button
                type="button"
                variant="outlined"
                intent="none"
                loading={passkeyBusy}
                onClick={() => void signInWithPasskey()}
              >
                <Fingerprint className="size-4" />
                {tr("auth.login.passkey", {
                  default: "Sign in with a passkey",
                })}
              </Button>
            </>
          )}

          {showDivider && (
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs">
                {tr("auth.login.or", { default: "OR" })}
              </span>
              <Separator className="flex-1" />
            </div>
          )}

          {!challenge && externalMethods.length > 0 && (
            <div className="flex flex-col gap-2">
              {externalMethods.map((method) => {
                const provider =
                  method.name.charAt(0).toUpperCase() + method.name.slice(1);
                return (
                  <Button
                    key={method.name}
                    variant="outlined"
                    onClick={() =>
                      auth.login(method.name, {
                        redirect,
                        realm: props.realmConfig.realmName,
                      })
                    }
                  >
                    <BrandIcon provider={method.name} />
                    {tr("auth.login.continueWith", {
                      default: `Continue with ${provider}`,
                      args: [provider],
                    })}
                  </Button>
                );
              })}
            </div>
          )}

          {!challenge && settings.registrationAllowed && (
            <p className="text-muted-foreground text-center text-sm">
              {tr("auth.login.noAccount", {
                default: "Don't have an account?",
              })}{" "}
              <a
                href={`${props.registerPath ?? "/auth/register"}${realmQuery}`}
                className="text-foreground underline underline-offset-4"
              >
                {tr("auth.login.signUp", { default: "Sign up" })}
              </a>
            </p>
          )}
        </CardContent>
      </Card>
      {props.cancelPath !== false && (
        <Button
          variant="minimal"
          nativeButton={false}
          render={<a href={props.cancelPath ?? "/"} />}
        >
          {tr("auth.login.cancel", { default: "Cancel" })}
        </Button>
      )}
    </div>
  );

  if (variant === "split") {
    const bgSrc = props.background?.src;
    const dotPattern =
      "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")";
    return (
      <div className="flex min-h-svh">
        <div
          className="bg-muted relative hidden flex-col items-center justify-center overflow-hidden p-16 lg:flex lg:w-1/2"
          style={
            bgSrc
              ? {
                  backgroundImage: `url(${JSON.stringify(bgSrc)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {!bgSrc && (
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.04] dark:opacity-[0.08]"
              style={{ backgroundImage: dotPattern }}
            />
          )}
          {props.background?.overlay && (
            <div className="relative z-10">{props.background.overlay}</div>
          )}
        </div>
        <div className="bg-background flex flex-1 items-center justify-center p-6">
          {formColumn}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      {formColumn}
    </div>
  );
};
