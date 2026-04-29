import { Control } from "@alepha/ui/components/control/control";
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
import { TypeBoxError, t } from "alepha";
import type { RealmConfig, UserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { Link, useRouter } from "alepha/react/router";
import { AlertCircle, Mail, User as UserIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

interface RegisterIntent {
  intentId: string;
}

const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  const userApi = useClient<UserController>();
  const router = useRouter();
  const settings = props.realmConfig.settings;
  const policy = settings.passwordPolicy;
  const realmQuery = props.realmConfig.realmName
    ? `?realm=${encodeURIComponent(props.realmConfig.realmName)}`
    : "";
  const [intent, setIntent] = useState<RegisterIntent | null>(null);
  const [code, setCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const form = useForm({
    id: "register",
    schema: t.object({
      username:
        settings.username !== "none"
          ? t.string({
              minLength: 3,
              maxLength: 30,
              title: "Username",
              format: "username",
            })
          : t.optional(t.string()),
      email:
        settings.email !== "none"
          ? t.string({ format: "email", title: "Email" })
          : t.optional(t.string()),
      password: t.string({
        format: "password",
        title: "Password",
        minLength: policy?.minLength ?? 8,
      }),
    }),
    handler: async (values) => {
      validatePasswordPolicy(values.password ?? "", policy);

      const result = await userApi.createRegistrationIntent({
        body: {
          username: values.username || undefined,
          email: values.email || undefined,
          password: values.password,
        },
      });
      setIntent({ intentId: result.intentId });
    },
  });

  const formState = useFormState(form, ["error"]);
  const formError =
    formState.error && !(formState.error instanceof TypeBoxError)
      ? formState.error.message
      : undefined;

  const submitVerification = async (e: FormEvent) => {
    e.preventDefault();
    if (!intent) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      await userApi.createUserFromIntent({
        body: { intentId: intent.intentId, emailCode: code },
      });
      await router.push(router.query.r || "/auth/login");
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : "Verification failed",
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            {settings.displayName && (
              <h2 className="text-center text-lg font-semibold">
                {settings.displayName}
              </h2>
            )}
            <h1 className="text-center text-base font-medium">
              Create your account
            </h1>

            {!intent ? (
              <form {...form.props} className="flex flex-col gap-3">
                {formError && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}
                {settings.username !== "none" && (
                  <Control input={form.input.username} icon={UserIcon} />
                )}
                {settings.email !== "none" && (
                  <Control input={form.input.email} icon={Mail} />
                )}
                <Control
                  input={form.input.password}
                  password
                  description={describePolicy(policy)}
                />

                <Button type="submit" disabled={form.submitting}>
                  {form.submitting ? "Creating account..." : "Sign up"}
                </Button>
              </form>
            ) : (
              <form
                onSubmit={submitVerification}
                className="flex flex-col gap-3"
              >
                <p className="text-muted-foreground text-sm">
                  We sent a verification code to your email. Enter it below to
                  finish creating your account.
                </p>
                {verifyError && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertDescription>{verifyError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-col items-center gap-1.5">
                  <Label htmlFor="verify-code">Verification code</Label>
                  <InputOTP
                    id="verify-code"
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    autoFocus
                    autoComplete="one-time-code"
                    pattern="^[A-Z0-9]*$"
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
                <Button type="submit" disabled={verifying || code.length < 6}>
                  {verifying ? "Verifying..." : "Verify and continue"}
                </Button>
              </form>
            )}

            <p className="text-muted-foreground text-center text-sm">
              Already have an account?{" "}
              <Link
                href={`/auth/login${realmQuery}`}
                className="text-foreground font-medium hover:underline"
              >
                Sign in
              </Link>
            </p>
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

type PasswordPolicy = RealmConfig["settings"]["passwordPolicy"];

const validatePasswordPolicy = (
  password: string,
  policy: PasswordPolicy | undefined,
) => {
  const fail = (message: string) => {
    throw new FormValidationError({ message, path: "/password" });
  };
  const min = policy?.minLength ?? 8;
  if (password.length < min) {
    fail(`Password must be at least ${min} characters`);
  }
  if (policy?.requireUppercase && !/[A-Z]/.test(password)) {
    fail("Password must contain at least one uppercase letter");
  }
  if (policy?.requireLowercase && !/[a-z]/.test(password)) {
    fail("Password must contain at least one lowercase letter");
  }
  if (policy?.requireNumbers && !/\d/.test(password)) {
    fail("Password must contain at least one number");
  }
  if (policy?.requireSpecialCharacters && !/[^a-zA-Z0-9]/.test(password)) {
    fail("Password must contain at least one special character");
  }
};

const describePolicy = (policy: PasswordPolicy | undefined): string => {
  const parts: string[] = [];
  parts.push(`at least ${policy?.minLength ?? 8} characters`);
  if (policy?.requireUppercase) parts.push("one uppercase letter");
  if (policy?.requireLowercase) parts.push("one lowercase letter");
  if (policy?.requireNumbers) parts.push("one number");
  if (policy?.requireSpecialCharacters) parts.push("one special character");
  return `Must contain ${parts.join(", ")}.`;
};

export default AuthRegisterPage;
