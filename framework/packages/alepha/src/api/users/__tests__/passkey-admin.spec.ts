import { describe, it } from "vitest";

import { IdentityService } from "../services/IdentityService.ts";
import { PasskeyService } from "../services/PasskeyService.ts";
import { PasskeyHarness } from "./passkeyHarness.ts";

/**
 * The operator's side: a passkey is an identity, so revoking one is the
 * existing identity delete, which for a passkey row audits `passkey_remove`
 * and notifies the user; revoking them all is one call; and an admin
 * response never carries the public key.
 */
describe("alepha/api/users - passkeys, admin side", () => {
  const enrolled = async () => {
    const h = await PasskeyHarness.boot({
      databaseUrl: "sqlite://:memory:",
      features: { notifications: true },
    });
    const user = await h.user();
    const browser = await h.signIn(user);
    await browser.addPasskey({ currentPassword: user.password });
    await browser.addPasskey(
      { currentPassword: user.password },
      "Phone",
      h.newDevice(),
    );
    h.email.records.splice(0);
    return { h, user };
  };

  it("lists a passkey row without its public key", async ({ expect }) => {
    const { h, user } = await enrolled();
    const identities = h.alepha.inject(IdentityService);
    const page = await identities.findIdentities({ userId: user.id });
    const passkey = page.content
      .map((it) => identities.toResource(it))
      .find((it) => it.provider === "passkey")!;

    expect(passkey.providerUserId).toBeTruthy();
    expect((passkey.providerData as any).name).toBeDefined();
    expect((passkey.providerData as any).publicKey).toBeUndefined();
  });

  it("revokes one passkey through the identity delete, and emails the user", async ({
    expect,
  }) => {
    const { h, user } = await enrolled();
    const passkeys = h.alepha.inject(PasskeyService);
    const [first] = await passkeys.passkeysOf(user.id);

    await h.alepha.inject(IdentityService).deleteIdentity(first!.id);

    expect(await passkeys.passkeysOf(user.id)).toHaveLength(1);
    await expect.poll(() => h.email.records.length).toBe(1);
    expect(h.email.records[0].subject).toBe(
      "A passkey was removed from your account",
    );
  });

  it("revokes every passkey of a user, and leaves the password", async ({
    expect,
  }) => {
    const { h, user } = await enrolled();
    const revoked = await h.alepha
      .inject(IdentityService)
      .revokeAllPasskeys(user.id);

    expect(revoked).toBe(2);
    expect(await h.alepha.inject(PasskeyService).passkeysOf(user.id)).toEqual(
      [],
    );
    const signedIn = await h.signIn(user);
    expect(signedIn.accessToken).toBeTruthy();
  });
});
