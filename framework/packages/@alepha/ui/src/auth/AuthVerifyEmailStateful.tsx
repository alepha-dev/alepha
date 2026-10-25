import * as React from "react";

void React;

import type { UserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { type ReactNode, useEffect, useState } from "react";

import type { VerifyEmailStep } from "./AuthVerifyEmail.tsx";
import { AuthVerifyEmailView } from "./AuthVerifyEmailView.tsx";

export interface AuthVerifyEmailStatefulProps {
  loginPath?: string;
  logo?: ReactNode;
}

export const AuthVerifyEmailStateful = (
  props: AuthVerifyEmailStatefulProps,
) => {
  const state = useRouterState();
  const { tr } = useI18n();
  const userCtrl = useClient<UserController>();
  const [step, setStep] = useState<VerifyEmailStep>("verifying");
  const [error, setError] = useState<string | null>(null);

  const email = state.query.email as string | undefined;
  const token = state.query.token as string | undefined;

  useEffect(() => {
    const verify = async () => {
      if (!email || !token) {
        setError(
          tr("auth.verify.invalidLink", {
            default: "Invalid verification link. Email and token are required.",
          }),
        );
        setStep("error");
        return;
      }
      try {
        await userCtrl.verifyEmail({ body: { email, token } });
        setStep("success");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : tr("auth.verify.failed", {
                default:
                  "Failed to verify your email. The link may have expired or is invalid.",
              }),
        );
        setStep("error");
      }
    };
    void verify();
  }, [email, token, userCtrl, tr]);

  return (
    <AuthVerifyEmailView
      step={step}
      error={error}
      loginPath={props.loginPath}
      logo={props.logo}
    />
  );
};
