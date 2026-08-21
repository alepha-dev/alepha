import * as React from "react";

void React;

import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { Control } from "@alepha/ui/components/control/control";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { AlephaError, SchemaValidationError, z } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { AlertCircle, Mail, User } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";

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
}

/**
 * Filter the `?redirect=` query param to a safe in-app destination:
 * - Only accept same-origin absolute paths (must start with a single `/`).
 * - Reject `//evil.com` / full URLs (open-redirect surface).
 * - Reject `/auth/*` to avoid bouncing the user back into the auth flow.
 */
const safeRedirect = (raw: string | string[] | undefined): string => {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/auth/")) return "/";
  return raw;
};

export function AuthLogin(props: AuthLoginProps) {
  const auth = useAuth();
  const router = useRouter();
  const { tr } = useI18n();
  const redirect = safeRedirect(router.query.redirect);
  const error = router.query.error;

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
  const identifierAutoComplete =
    loginMethods.length === 1
      ? loginMethods[0] === "email"
        ? "email"
        : loginMethods[0] === "phone"
          ? "tel"
          : "username"
      : "username";

  const form = useForm({
    schema: z.object({
      identifier: z.string().min(1),
      password: z.string().min(settings.passwordPolicy?.minLength || 6),
    }),
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
        if (
          err instanceof HttpError &&
          err.error === "InvalidCredentialsError"
        ) {
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

  // Autofocus the identifier field on mount — but only when credentials is the
  // *sole* login method. With OAuth/external buttons present we don't steal
  // focus (and trigger the browser's autofill popup) from a user who came to
  // click "Continue with …". `<Control>` has no `autoFocus` prop, so we grab
  // the id the form assigned and focus it.
  const identifierId = form.input.identifier.props.id;
  useEffect(() => {
    if (!credentialsProvider || externalMethods.length > 0 || !identifierId) {
      return;
    }
    (
      document.getElementById(String(identifierId)) as HTMLInputElement | null
    )?.focus();
  }, [credentialsProvider, externalMethods.length, identifierId]);

  const formState = useFormState(form, ["error", "loading"]);
  const formError =
    formState.error && !(formState.error instanceof SchemaValidationError)
      ? formState.error.message
      : undefined;
  const showDivider = credentialsProvider && externalMethods.length > 0;
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

          {(error || formError) && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error || formError}</AlertDescription>
            </Alert>
          )}

          {credentialsProvider && (
            <form {...form.props} className="flex flex-col gap-4">
              <Control
                label={identifierLabel}
                input={form.input.identifier}
                icon={identifierIcon}
                autoComplete={identifierAutoComplete}
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

          {showDivider && (
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs">
                {tr("auth.login.or", { default: "OR" })}
              </span>
              <Separator className="flex-1" />
            </div>
          )}

          {externalMethods.length > 0 && (
            <div className="flex flex-col gap-2">
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

          {settings.registrationAllowed && (
            <p className="text-muted-foreground text-center text-sm">
              {tr("auth.login.noAccount", {
                default: "Don't have an account?",
              })}{" "}
              <a
                href={`${props.registerPath ?? "/auth/register"}${realmQuery}`}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {tr("auth.login.signUp", { default: "Sign up" })}
              </a>
            </p>
          )}
        </CardContent>
      </Card>
      <Button variant="ghost" nativeButton={false} render={<a href="/" />}>
        {tr("auth.login.cancel", { default: "Cancel" })}
      </Button>
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
}
