import { AlephaError, t } from "alepha";
import type {
  RealmConfig,
  RegistrationIntentResponse,
  UserController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Control } from "@/registry/default/control/control";
import { iconFor } from "@/registry/default/control-base/icon-hint";

export interface AuthRegisterProps {
  realmConfig: RealmConfig;
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
        throw new AlephaError("Passwords do not match");
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
        err instanceof Error ? err.message : "Verification failed",
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
              Verify your account
            </h2>
            <p className="text-muted-foreground text-center text-sm">
              Please enter the verification code(s) sent to you.
            </p>
            {verifyError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{verifyError}</AlertDescription>
              </Alert>
            )}
            {state.intent.expectEmailVerification && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="emailCode">Email verification code</Label>
                <Input
                  id="emailCode"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={emailCode}
                  onChange={(e) =>
                    setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </div>
            )}
            {state.intent.expectPhoneVerification && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="phoneCode">Phone verification code</Label>
                <Input
                  id="phoneCode"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={phoneCode}
                  onChange={(e) =>
                    setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </div>
            )}
            <Button onClick={handleVerify} disabled={!canSubmit || submitting}>
              Complete registration
            </Button>
            <Button variant="ghost" onClick={() => setState({ phase: "form" })}>
              Back to registration
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
                  Registration is not available. Please contact your
                  administrator.
                </AlertDescription>
              </Alert>
              <Button asChild>
                <a href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}>
                  Back to sign in
                </a>
              </Button>
            </>
          ) : (
            <>
              {credentialsProvider && (
                <form {...form.props} className="flex flex-col gap-4">
                  {settings.username !== "none" && form.input.username && (
                    <Control
                      label="Username"
                      input={form.input.username}
                      icon={iconFor("user")}
                    />
                  )}
                  {settings.email !== "none" && form.input.email && (
                    <Control
                      label="Email"
                      input={form.input.email}
                      icon={iconFor("email")}
                    />
                  )}
                  {settings.phoneNumber !== "none" &&
                    form.input.phoneNumber && (
                      <Control
                        label="Phone number"
                        input={form.input.phoneNumber}
                        icon={iconFor("phone")}
                      />
                    )}
                  <Control
                    label="Password"
                    input={form.input.password}
                    password
                  />
                  <Control
                    label="Confirm password"
                    input={form.input.confirmPassword}
                    password
                  />
                  <Button type="submit" disabled={form.submitting}>
                    Create account
                  </Button>
                </form>
              )}
              {showDivider && (
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
                      redirect,
                      realm: props.realmConfig.realmName,
                    })
                  }
                >
                  Continue with{" "}
                  {method.name.charAt(0).toUpperCase() + method.name.slice(1)}
                </Button>
              ))}
              <p className="text-muted-foreground text-center text-sm">
                Already have an account?{" "}
                <a
                  href={`${props.loginPath ?? "/auth/login"}${realmQuery}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </a>
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <Button variant="ghost" asChild>
        <a href={redirect}>Cancel</a>
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
