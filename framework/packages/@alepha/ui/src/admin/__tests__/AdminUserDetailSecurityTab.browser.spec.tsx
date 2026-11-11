import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { IdentityResource } from "alepha/api/users";
import { AlephaContext } from "alepha/react";
import type { UseActionReturn } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminUserDetailSecurityTab } from "../AdminUserDetailSecurityTab.tsx";

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
  const mount = async (enrolled: boolean, extra: IdentityResource[] = []) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminUserDetailSecurityTab
          hasPassword
          socialIdentities={[
            ...(enrolled
              ? [identity("google"), identity("totp")]
              : [identity("google")]),
            ...extra,
          ]}
          removeIdentity={action()}
          clearTotp={action()}
          revokePasskey={action()}
          revokeAllPasskeys={action() as never}
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

  it("should list passkeys in their own group, with a fingerprint and never the credential id", async () => {
    const passkey = {
      id: "id-passkey",
      provider: "passkey",
      providerUserId: "Q1JFREVOVElBTC1JRA",
      createdAt: "2026-11-01T10:00:00.000Z",
      providerData: { name: "Work laptop", backedUp: true },
    } as never as IdentityResource;
    await mount(false, [passkey]);

    expect(screen.queryByText("Passkeys")).toBeTruthy();
    expect(screen.queryByText("Work laptop")).toBeTruthy();
    expect(screen.queryByText("Synced")).toBeTruthy();
    expect(screen.queryByText(/Q1JFREVOVElBTC1JRA/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeTruthy();
  });
});
