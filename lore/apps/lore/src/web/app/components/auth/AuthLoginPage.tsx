import { Control } from "@alepha/ui/components/control/control";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { AlephaError, TypeBoxError, t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { useAuth } from "alepha/react/auth";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { Link, useRouter } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { AlertCircle, Mail, User as UserIcon } from "lucide-react";
import PageHeader from "../shared/header/PageHeader.tsx";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

const AuthLoginPage = (props: AuthLoginPageProps) => {
  const auth = useAuth();
  const router = useRouter();
  const settings = props.realmConfig.settings;
  const queryError = router.query.error;

  const safeRedirect = (() => {
    const raw = router.query.r;
    if (typeof raw !== "string" || raw.length === 0) return "/";
    // Only allow same-origin paths, and never bounce back into the auth flow.
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
    if (raw.startsWith("/auth/")) return "/";
    return raw;
  })();

  const credentialsProvider = props.realmConfig.authenticationMethods.find(
    (it) => it.type === "CREDENTIALS",
  );
  const externalMethods = props.realmConfig.authenticationMethods.filter(
    (m) => m.type !== "CREDENTIALS",
  );
  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";

  const identifierIcon =
    settings.email !== "none" && settings.username === "none" ? Mail : UserIcon;
  const identifierTitle =
    settings.email !== "none" && settings.username === "none"
      ? "Email"
      : settings.username !== "none" && settings.email === "none"
        ? "Username"
        : "Username or email";

  const form = useForm({
    id: "login",
    schema: t.object({
      identifier: t.string({ minLength: 1, title: identifierTitle }),
      password: t.string({
        format: "password",
        title: "Password",
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
        await router.push(safeRedirect);
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

  const formState = useFormState(form, ["error"]);
  const formError =
    formState.error && !(formState.error instanceof TypeBoxError)
      ? formState.error.message
      : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <PageHeader />
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {settings.logoUrl && (
          <img
            src={settings.logoUrl}
            alt={settings.displayName || props.realmConfig.realmName}
            className="size-16 rounded-xl border bg-muted object-cover shadow-sm"
          />
        )}
        <Card className="w-full">
          <CardContent className="flex flex-col gap-4">
            {settings.displayName && (
              <h2 className="text-center text-lg font-semibold">
                {settings.displayName}
              </h2>
            )}
            <h1 className="text-center text-base font-medium">Sign in</h1>

            {(queryError || formError) && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{queryError || formError}</AlertDescription>
              </Alert>
            )}

            {credentialsProvider && (
              <form {...form.props} className="flex flex-col gap-3">
                <Control input={form.input.identifier} icon={identifierIcon} />
                <Control input={form.input.password} password />
                <Button type="submit" disabled={form.submitting}>
                  {form.submitting ? "Signing in..." : "Sign in"}
                </Button>
                {settings.resetPasswordAllowed && (
                  <Link
                    href={`/auth/reset-password${realmQuery}`}
                    className="text-muted-foreground hover:text-foreground text-center text-sm hover:underline"
                  >
                    Forgot password?
                  </Link>
                )}
              </form>
            )}

            {credentialsProvider && externalMethods.length > 0 && (
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">OR</span>
                <Separator className="flex-1" />
              </div>
            )}

            {externalMethods.map((method) => (
              <Button
                key={method.name}
                variant="outline"
                onClick={() =>
                  auth.login(method.name, {
                    redirect: safeRedirect,
                    realm: props.realmConfig.realmName,
                  })
                }
              >
                Continue with{" "}
                {method.name.charAt(0).toUpperCase() + method.name.slice(1)}
              </Button>
            ))}

            {settings.registrationAllowed && (
              <p className="text-muted-foreground text-center text-sm">
                Don&apos;t have an account?{" "}
                <Link
                  href={`/auth/register${realmQuery}`}
                  className="text-foreground font-medium hover:underline"
                >
                  Sign up
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-center text-sm"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
};

export default AuthLoginPage;
