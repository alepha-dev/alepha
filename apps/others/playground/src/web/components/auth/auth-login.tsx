import { AlephaError, t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { AlertCircle, Lock, User } from "lucide-react";
import { useMemo } from "react";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Separator } from "@/web/components/ui/separator";

export interface AuthLoginProps {
  realmConfig: RealmConfig;
  registerPath?: string;
  resetPasswordPath?: string;
}

export function AuthLogin(props: AuthLoginProps) {
  const auth = useAuth();
  const router = useRouter();
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
      if (m === "email") return "Email";
      if (m === "phone") return "Phone number";
      return "Username";
    }
    const labels: Record<string, string> = {
      username: "username",
      email: "email",
      phone: "phone",
    };
    const parts = loginMethods.map((m) => labels[m]);
    return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
  }, [loginMethods]);

  const autoComplete = loginMethods.includes("email")
    ? "email"
    : loginMethods.includes("phone")
      ? "tel"
      : "username";

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
            message: "Invalid identifier or password",
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

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
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
                <div className="flex flex-col gap-2">
                  <Label htmlFor="identifier">{identifierLabel}</Label>
                  <div className="relative">
                    <User className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      id="identifier"
                      autoComplete={autoComplete}
                      className="pl-9"
                      {...form.input.identifier.props}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      className="pl-9"
                      {...form.input.password.props}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={form.submitting}>
                  Sign in
                </Button>
                {settings.resetPasswordAllowed && (
                  <a
                    href={`${props.resetPasswordPath ?? "/auth/reset-password"}${realmQuery}`}
                    className="text-muted-foreground hover:text-foreground text-center text-sm underline-offset-4 hover:underline"
                  >
                    Forgot password?
                  </a>
                )}
              </form>
            )}

            {showDivider && (
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">OR</span>
                <Separator className="flex-1" />
              </div>
            )}

            {externalMethods.length > 0 && (
              <div className="flex flex-col gap-2">
                {externalMethods.map((method) => (
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
                    Continue with{" "}
                    {method.name.charAt(0).toUpperCase() + method.name.slice(1)}
                  </Button>
                ))}
              </div>
            )}

            {settings.registrationAllowed && (
              <p className="text-muted-foreground text-center text-sm">
                Don&apos;t have an account?{" "}
                <a
                  href={`${props.registerPath ?? "/auth/register"}${realmQuery}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Sign up
                </a>
              </p>
            )}
          </CardContent>
        </Card>
        <Button variant="ghost" asChild>
          <a href="/">Cancel</a>
        </Button>
      </div>
    </div>
  );
}
