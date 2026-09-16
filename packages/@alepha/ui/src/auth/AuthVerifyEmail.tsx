import * as React from "react";

void React;

import type { ReactNode } from "react";

import { AuthVerifyEmailStateful } from "./AuthVerifyEmailStateful.tsx";
import { AuthVerifyEmailView } from "./AuthVerifyEmailView.tsx";

export interface AuthVerifyEmailProps {
  /**
   * Route to the login page, shown as a CTA on success/failure.
   */
  loginPath?: string;
  /**
   * Render a fixed step (useful for storybook / testing).
   */
  step?: VerifyEmailStep;
  /**
   * Custom logo node, rendered above the card.
   */
  logo?: ReactNode;
}

export const AuthVerifyEmail = (props: AuthVerifyEmailProps) => {
  if (props.step) {
    return (
      <AuthVerifyEmailView
        step={props.step}
        loginPath={props.loginPath}
        logo={props.logo}
      />
    );
  }
  return (
    <AuthVerifyEmailStateful loginPath={props.loginPath} logo={props.logo} />
  );
};

export type VerifyEmailStep = "verifying" | "success" | "error";
