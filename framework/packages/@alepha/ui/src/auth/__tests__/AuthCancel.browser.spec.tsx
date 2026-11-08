import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { AlephaServerLinks } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import { AuthLogin } from "../AuthLogin.tsx";
import { AuthRegister } from "../AuthRegister.tsx";
import { AuthResetPassword } from "../AuthResetPassword.tsx";

/**
 * The "Cancel" link under the sign-in, registration and password-reset forms.
 *
 * It leads to "/" by default, which is right for an application with public
 * pages. In an application where every page needs an account, "/" sends the
 * visitor straight back to sign-in, so `cancelPath={false}` hides the link and
 * a string points it elsewhere.
 */
describe("Auth forms - the Cancel link", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const realmConfig = {
    realmName: "default",
    authenticationMethods: [{ type: "CREDENTIALS", name: "credentials" }],
    settings: {
      username: "none",
      email: "required",
      phoneNumber: "none",
      registrationAllowed: true,
      resetPasswordAllowed: true,
    },
  } as unknown as RealmConfig;

  const mount = async (node: ReactNode) => {
    alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>{node}</DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  /**
   * The kit's `Button` rendered as an anchor keeps `role="button"`.
   */
  const cancelLink = () => screen.queryByRole("button", { name: "Cancel" });

  describe("AuthLogin", () => {
    it("should lead to / by default", async () => {
      await mount(<AuthLogin realmConfig={realmConfig} />);

      expect(cancelLink()?.getAttribute("href")).toBe("/");
    });

    it("should lead to the given cancelPath", async () => {
      await mount(<AuthLogin realmConfig={realmConfig} cancelPath="/home" />);

      expect(cancelLink()?.getAttribute("href")).toBe("/home");
    });

    it("should hide the link when cancelPath is false", async () => {
      await mount(<AuthLogin realmConfig={realmConfig} cancelPath={false} />);

      expect(screen.queryByText("Sign up")).toBeTruthy();
      expect(cancelLink()).toBeNull();
    });
  });

  describe("AuthRegister", () => {
    it("should lead to / by default", async () => {
      await mount(<AuthRegister realmConfig={realmConfig} />);

      expect(cancelLink()?.getAttribute("href")).toBe("/");
    });

    it("should hide the link when cancelPath is false", async () => {
      await mount(
        <AuthRegister realmConfig={realmConfig} cancelPath={false} />,
      );

      expect(cancelLink()).toBeNull();
    });
  });

  describe("AuthResetPassword", () => {
    it("should lead to / by default", async () => {
      await mount(<AuthResetPassword realmConfig={realmConfig} />);

      expect(cancelLink()?.getAttribute("href")).toBe("/");
    });

    it("should lead to the given cancelPath", async () => {
      await mount(
        <AuthResetPassword realmConfig={realmConfig} cancelPath="/home" />,
      );

      expect(cancelLink()?.getAttribute("href")).toBe("/home");
    });

    it("should hide the link when cancelPath is false", async () => {
      await mount(
        <AuthResetPassword realmConfig={realmConfig} cancelPath={false} />,
      );

      expect(cancelLink()).toBeNull();
    });
  });
});
