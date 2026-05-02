import { Control } from "@alepha/ui/components/control/control";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { AlephaError, t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { AlertCircle } from "lucide-react";
import { type ReactNode, useMemo } from "react";

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
}

export function AuthLogin(props: AuthLoginProps) {
  const auth = useAuth();
  const router = useRouter();
  const { tr } = useI18n();
  const redirect = router.query.r || "/";
  const error = router.query.error;

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const settings = props.realmConfig.settings;

  const loginMethods = useMemo(() => {
    const methods: string[] = [];
    if (settings.username !== "none") methods.push("username");
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

  const form = useForm({
    schema: t.object({
      identifier: t.string({ minLength: 1 }),
      password: t.string({
        minLength: settings.passwordPolicy?.minLength || 6,
      }),
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
        await router.push(router.query.r || "/");
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
        throw err;
      }
    },
  });

  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (m) => m.type !== "CREDENTIALS",
  );
  const showDivider = credentialsProvider && externalMethods.length > 0;
  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";

  const variant = props.variant ?? "centered";

  const formColumn = (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          {(settings.logoUrl ||
            settings.displayName ||
            settings.description) && (
            <div className="flex flex-col items-center gap-1">
              {settings.logoUrl && (
                <img
                  src={settings.logoUrl}
                  alt={settings.displayName || props.realmConfig.realmName}
                  className="h-12 w-auto object-contain"
                />
              )}
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

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {credentialsProvider && (
            <form {...form.props} className="flex flex-col gap-4">
              <Control label={identifierLabel} input={form.input.identifier} />
              <Control
                label={tr("auth.login.password", {
                  default: "Password",
                })}
                input={form.input.password}
                password
              />
              <Button type="submit" disabled={form.submitting}>
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
      <Button variant="ghost" asChild>
        <a href="/">{tr("auth.login.cancel", { default: "Cancel" })}</a>
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
