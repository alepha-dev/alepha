import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { IdentityResource } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import type { UseActionReturn } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminUserDetailSecurityTab } from "../admin-user-detail-security-tab.tsx";

/**
 * The support case this tab has to serve is a user who lost the phone holding
 * their authenticator app and has no recovery code left.
 *
 * A TOTP enrollment is stored as an ordinary `identities` row, so left alone
 * it surfaces under "Connected accounts" beside the OAuth providers, offering
 * to remove a "connection" the user cannot sign in with in the first place.
 * It gets its own card, and it stays out of the connected-accounts list.
 */
describe("AdminUserDetailSecurityTab - two-factor", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const action = (): UseActionReturn<[IdentityResource], void> =>
    ({ run: async () => undefined, loading: false }) as never;

  const identity = (provider: string): IdentityResource =>
    ({ id: `id-${provider}`, provider }) as never;

  /**
   * Mounted with whatever the parent already computes: every identity except
   * `credentials`, the `totp` row included. Splitting it out is this
   * component's job, so the rule cannot be lost by a caller.
   */
  const mount = async (enrolled: boolean) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminUserDetailSecurityTab
          hasPassword
          socialIdentities={
            enrolled
              ? [identity("google"), identity("totp")]
              : [identity("google")]
          }
          removeIdentity={action()}
          clearTotp={action()}
          onChangePassword={() => {}}
        />
      </AlephaContext.Provider>,
    );
  };

  it("should offer to clear the second factor when one is enrolled", async () => {
    await mount(true);

    expect(screen.queryByText("Two-factor authentication")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Clear second factor/ }),
    ).toBeTruthy();
  });

  it("should say so when no second factor is enrolled", async () => {
    await mount(false);

    expect(screen.queryByText("Two-factor authentication")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Clear second factor/ }),
    ).toBeNull();
  });

  /*
   * The authenticator app is not a way in, so listing it next to Google
   * invites an administrator to "remove a connection" that was never one.
   */
  it("should not list the authenticator app as a connected account", async () => {
    await mount(true);

    expect(screen.queryByText("Google")).toBeTruthy();
    expect(screen.queryByText("Authenticator app")).toBeNull();
  });
});
