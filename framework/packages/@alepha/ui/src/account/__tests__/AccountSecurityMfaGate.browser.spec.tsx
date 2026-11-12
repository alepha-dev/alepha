import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaServerLinks, LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DialogProvider } from "../../core/useDialog.tsx";
import AccountSecurity from "../AccountSecurity.tsx";

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
/**
 * What `getRealmConfig` answers, set by each test's `mount`.
 */
let realm: RealmConfig | undefined;

/**
 * The section fetches its identities (none) and the realm; every other call
 * answers nothing, as an unreachable server would.
 */
class Links extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async () => {
            if (name === "listMyIdentities") return [];
            if (name === "getRealmConfig") return realm;
            return undefined;
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }
}

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
    realm = config;
    alepha = Alepha.create()
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReactI18n)
      .with(AlephaReactAuth)
      .with(AlephaServerLinks);
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AccountSecurity />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    // Past the skeleton: an absent row means absent, not still loading.
    await screen.findByText("Sign-in methods");
    return view;
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
