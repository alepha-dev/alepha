import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { AlephaServerLinks } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import AccountSecurity from "../account-security.tsx";

/**
 * A realm that has turned the authenticator-app factor off must not be
 * offered it.
 *
 * Left ungated, the page walks the user through a QR and ten recovery codes
 * for a factor `methodsFor` never returns, so the login gate never asks for
 * it while the page reports it as on. The server refuses the enrollment too;
 * this is the half that stops the user reaching a dead end in the first
 * place.
 */
describe("AccountSecurity - two-factor row against the realm setting", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const realmConfig = (totp: string) =>
    ({ settings: { mfa: { totp } } }) as unknown as RealmConfig;

  const mount = async (config?: RealmConfig) => {
    alepha = Alepha.create()
      .with(AlephaReactI18n)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AccountSecurity identities={[]} realmConfig={config} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("should not offer two-factor when the realm has totp disabled", async () => {
    await mount(realmConfig("disabled"));

    expect(screen.queryByText("Two-factor authentication")).toBeNull();
  });

  it("should offer two-factor when the realm allows totp", async () => {
    await mount(realmConfig("optional"));

    expect(screen.queryByText("Two-factor authentication")).toBeTruthy();
  });

  /*
   * An application that never passes the config keeps the row. Hiding a
   * factor a realm does want is the worse failure of the two, and the server
   * still refuses an enrollment the realm has turned off.
   */
  it("should keep offering two-factor when no realm config is supplied", async () => {
    await mount(undefined);

    expect(screen.queryByText("Two-factor authentication")).toBeTruthy();
  });
});
