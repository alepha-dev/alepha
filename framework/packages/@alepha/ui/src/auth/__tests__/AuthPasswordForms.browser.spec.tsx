import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth, ReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { BadRequestError } from "alepha/server";
import { AlephaServerLinks, LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AuthLogin } from "../AuthLogin.tsx";
import { AuthResetPassword } from "../AuthResetPassword.tsx";

/**
 * `login` with no server behind it: records the password it was sent.
 */
class RecordingReactAuth extends ReactAuth {
  public passwords: string[] = [];

  public override async login(
    _provider: string,
    options: Parameters<ReactAuth["login"]>[1],
  ): Promise<any> {
    this.passwords.push(options.password ?? "");
    return {};
  }
}

/**
 * Stands in for the password-reset routes: hands out one intent, accepts
 * the code `123456` only, as `CredentialService.completePasswordReset`
 * does, and records every completion it was sent.
 */
class Links extends LinkProvider {
  public completions: Array<{ code: string; newPassword: string }> = [];

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            if (name === "createPasswordResetIntent") {
              return { intentId: "intent-1", expiresAt: "2099-01-01" };
            }
            if (name === "completePasswordReset") {
              this.completions.push({
                code: input.body.code,
                newPassword: input.body.newPassword,
              });
              if (input.body.code !== "123456") {
                throw new BadRequestError(
                  "Invalid or expired verification code",
                );
              }
              return { ok: true };
            }
            return undefined;
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

/**
 * The password fields of the sign-in and reset forms, against the realm's
 * password policy: sign-in checks none (the server decides), a new password
 * is held to the realm's minimum, and a refused reset code leads back to the
 * code step.
 */
describe("Auth forms - passwords", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const realmConfig = (minLength?: number) =>
    ({
      realmName: "default",
      authenticationMethods: [{ type: "CREDENTIALS", name: "credentials" }],
      settings: {
        username: "none",
        email: "required",
        phoneNumber: "none",
        registrationAllowed: true,
        resetPasswordAllowed: true,
        ...(minLength === undefined
          ? {}
          : {
              passwordPolicy: {
                minLength,
                requireUppercase: false,
                requireLowercase: false,
                requireNumbers: false,
                requireSpecialCharacters: false,
              },
            }),
      },
    }) as unknown as RealmConfig;

  const mount = async (node: ReactNode) => {
    alepha = Alepha.create()
      .with({ provide: ReactAuth, use: RecordingReactAuth })
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{node}</DialogProvider>
      </AlephaContext.Provider>,
    );
    return {
      auth: alepha.inject(ReactAuth) as RecordingReactAuth,
      links: alepha.inject(LinkProvider) as Links,
    };
  };

  const type = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  describe("AuthLogin", () => {
    const signIn = async (password: string) => {
      type(/^Email/, "ada@example.com");
      type(/^Password/, password);
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    };

    it("sends a password shorter than the realm's current minimum", async () => {
      const { auth } = await mount(<AuthLogin realmConfig={realmConfig(12)} />);
      await signIn("Abcdef12");

      await waitFor(() => expect(auth.passwords).toEqual(["Abcdef12"]));
    });

    it("sends a short password from a realm with no policy", async () => {
      const { auth } = await mount(<AuthLogin realmConfig={realmConfig()} />);
      await signIn("abcd");

      await waitFor(() => expect(auth.passwords).toEqual(["abcd"]));
    });
  });

  describe("AuthResetPassword", () => {
    const reachPasswordStep = async (code: string) => {
      type(/^Email/, "ada@example.com");
      fireEvent.click(
        screen.getByRole("button", { name: "Send verification code" }),
      );
      await screen.findByText("Enter the 6-digit code");
      const input = document.querySelector<HTMLInputElement>(
        "input[data-input-otp]",
      )!;
      fireEvent.change(input, { target: { value: code } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByText("Create your new password");
    };

    const choose = (password: string) => {
      type(/^New password/, password);
      type(/^Confirm password/, password);
      fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    };

    it("takes a password as short as the realm's minimum", async () => {
      const { links } = await mount(
        <AuthResetPassword realmConfig={realmConfig(6)} />,
      );
      await reachPasswordStep("123456");
      choose("abcdef");

      await screen.findByText("Your password has been reset successfully.");
      expect(links.completions).toEqual([
        { code: "123456", newPassword: "abcdef" },
      ]);
    });

    it("refuses a password shorter than the realm's minimum before sending it", async () => {
      const { links } = await mount(
        <AuthResetPassword realmConfig={realmConfig(12)} />,
      );
      await reachPasswordStep("123456");
      choose("Abcdef12");

      await waitFor(() =>
        expect(
          screen.getByLabelText(/^New password/).getAttribute("aria-invalid"),
        ).toBe("true"),
      );
      expect(links.completions).toEqual([]);
    });

    it("goes back to the code step, cleared, when the code is refused", async () => {
      const { links } = await mount(
        <AuthResetPassword realmConfig={realmConfig(6)} />,
      );
      await reachPasswordStep("123457");
      choose("abcdefgh");

      await screen.findByText("Invalid or expired verification code");
      await screen.findByText("Enter the 6-digit code");
      expect(
        document.querySelector<HTMLInputElement>("input[data-input-otp]")!
          .value,
      ).toBe("");

      const input = document.querySelector<HTMLInputElement>(
        "input[data-input-otp]",
      )!;
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByText("Create your new password");
      choose("abcdefgh");

      await screen.findByText("Your password has been reset successfully.");
      expect(links.completions.map((it) => it.code)).toEqual([
        "123457",
        "123456",
      ]);
    });

    it("leads back from the password step to the code step", async () => {
      await mount(<AuthResetPassword realmConfig={realmConfig(6)} />);
      await reachPasswordStep("123457");

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      await screen.findByText("Enter the 6-digit code");
      expect(
        document.querySelector<HTMLInputElement>("input[data-input-otp]")!
          .value,
      ).toBe("");
    });
  });
});
