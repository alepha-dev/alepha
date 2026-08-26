import { buttonVariants } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useAuth } from "alepha/react/auth";
import { Link } from "alepha/react/router";
import { KeyRound, ShieldCheck, SmartphoneNfc } from "lucide-react";

/**
 * The one page this example writes for itself.
 *
 * It explains what to do and then gets out of the way: every screen that
 * matters (sign-in, the code step, enrollment, the admin tab) comes from the
 * framework, so the interesting part of this demo is deliberately not here.
 */
const Home = () => {
  const auth = useAuth();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Two-factor authentication, as a realm setting
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          This application contains no authentication code. It registers{" "}
          <code className="text-foreground font-mono text-sm">
            AlephaApiUsers
          </code>{" "}
          and sets{" "}
          <code className="text-foreground font-mono text-sm">
            mfa.totp: "optional"
          </code>{" "}
          on its realm. Everything below is what those two lines produce.
        </p>

        <div className="flex flex-wrap gap-3">
          {auth.user ? (
            <Link href="/account/security" className={buttonVariants()}>
              <ShieldCheck className="size-4" />
              Set up two-factor authentication
            </Link>
          ) : (
            <>
              <Link href="/auth/register" className={buttonVariants()}>
                Create an account
              </Link>
              <Link
                href="/auth/login"
                className={buttonVariants({ variant: "secondary" })}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SmartphoneNfc className="size-4" />
              Enroll
            </CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">/account/security</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Scan the QR code with any authenticator app, confirm one code, and
            keep the ten recovery codes. The QR is rendered server-side as SVG,
            so nothing in the browser needs a QR library.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              Sign in
            </CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">/auth/login</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            The password alone no longer returns a session. It returns a signed
            five-minute challenge, and the code step exchanges it for one. A
            recovery code works here too, once each.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Recover
            </CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">/admin</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Lost the phone and the recovery codes? An administrator clears the
            second factor from the user's security tab, and the account signs in
            on its password again.
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">
          Things worth trying
        </h2>
        <ul className="text-muted-foreground flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Reuse a code within its 30-second window. It is refused: a time step
            is burned once accepted.
          </li>
          <li>
            Let a code age past the window. Verification allows one step either
            side for clock drift, and no more.
          </li>
          <li>
            Spend a recovery code, then spend it again. The second attempt
            fails.
          </li>
          <li>
            Get the code wrong repeatedly. Second-factor attempts have their own
            rate-limit counter, separate from the password one, so failing here
            does not spend the budget protecting the password.
          </li>
          <li>
            Turn it off from the account page. It asks for a current code, not
            just a confirmation: an unattended signed-in browser is not proof.
          </li>
        </ul>
      </section>

      <section className="text-muted-foreground text-sm">
        <p>
          There is no password reset and no email verification, because this
          realm has no email provider. That is the constraint the whole
          configuration answers, and the reason the second factor is an
          authenticator app rather than a mailed code: a realm whose reset
          channel is email gains much less from a second factor that is also
          email.
        </p>
      </section>
    </div>
  );
};

export default Home;
