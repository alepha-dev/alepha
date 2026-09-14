import * as React from "react";

void React;

import type { RealmConfig } from "alepha/api/users";
import type { useAuth } from "alepha/react/auth";
import type { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AlertCircle, Info } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Alert, AlertDescription } from "../core/Alert.tsx";
import { BrandIcon } from "../core/BrandIcon.tsx";
import { Button } from "../core/Button.tsx";
import { Separator } from "../core/Separator.tsx";
import { Control } from "../form/Control.tsx";
import { iconFor } from "../form/iconHint.tsx";
import { AuthRegisterPasswordRules } from "./AuthRegisterPasswordRules.tsx";
import { AuthRegisterRealmHeader } from "./AuthRegisterRealmHeader.tsx";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "./TurnstileWidget.tsx";

export interface AuthRegisterFormPhaseProps {
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
  lockedEmail?: string;
}

export const AuthRegisterFormPhase = (props: AuthRegisterFormPhaseProps) => {
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
      <AuthRegisterRealmHeader
        settings={settings}
        realmName={props.realmName}
      />
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
                    props.lockedEmail
                      ? tr("auth.register.email.locked", {
                          default: "This is the address you were invited with.",
                        })
                      : settings.verifyEmailRequired
                        ? tr("auth.register.email.verify", {
                            default:
                              "We'll send a verification code to confirm your email.",
                          })
                        : undefined
                  }
                  input={form.input.email}
                  icon={iconFor("email")}
                  // Locked, not hidden: the visitor has to be able to see
                  // which address they are about to create an account for,
                  // and it is often not the one they would have typed. The
                  // value lives in the form model rather than the DOM, so
                  // disabling the input does not drop it from the submit.
                  disabled={!!props.lockedEmail}
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
                <AuthRegisterPasswordRules
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
};
