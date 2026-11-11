import { describe, it } from "vitest";

import { publicRealmSettingsSchema } from "../schemas/realmConfigSchema.ts";
import { PasskeyService } from "../services/PasskeyService.ts";
import { PasskeyHarness } from "./passkeyHarness.ts";

const drivers = [
  ["SQLite", "sqlite://:memory:"],
  ["Postgres", undefined],
] as const;

describe.each(drivers)(
  "alepha/api/users - passkeys on %s",
  (_, databaseUrl) => {
    const boot = (options: Parameters<typeof PasskeyHarness.boot>[0] = {}) =>
      PasskeyHarness.boot({ databaseUrl, ...options });

    it("adds a passkey on a password account, with the current password", async ({
      expect,
    }) => {
      const h = await boot();
      const browser = await h.signIn(await h.user());

      expect((await browser.list()).proof).toBe("password");
      const added = await browser.addPasskey({ currentPassword: "Secret-123" });
      expect(added.status).toBe(200);
      expect(added.body.name).toBe("Laptop");

      const list = await browser.list();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        name: "Laptop",
        backedUp: true,
        usable: true,
      });
      expect(list.items[0].publicKey).toBeUndefined();

      // The next enrolment excludes the credential already held.
      const options = await browser.call(
        "POST",
        "/api/users/me/passkeys/options",
      );
      expect(options.body.excludeCredentials).toHaveLength(1);
      expect(options.body.authenticatorSelection.residentKey).toBe("required");
      expect(options.body.attestation).toBe("none");
      await expect(h.device.create(options.body)).rejects.toThrow(
        "excluded credentials",
      );
    });

    it("refuses a wrong or missing password, and an assertion in its place", async ({
      expect,
    }) => {
      const h = await boot();
      const browser = await h.signIn(await h.user());

      const wrong = await browser.addPasskey({ currentPassword: "nope" });
      expect(wrong.status).toBe(400);
      expect(wrong.body.name).toBe("PASSKEY_PASSWORD_PROOF");
      expect(wrong.body.message).toBe("Current password is incorrect");

      const missing = await browser.addPasskey();
      expect(missing.body.name).toBe("PASSKEY_PASSWORD_PROOF");
      expect(missing.body.data.reason).toBe("missing");

      // A password account proves with its password, even with a passkey to
      // hand.
      await browser.addPasskey({ currentPassword: "Secret-123" });
      const assertion = await browser
        .call("POST", "/api/users/me/passkeys/proof/options")
        .then((it) => h.device.get(it.body));
      const instead = await browser.addPasskey(
        { assertion },
        "Phone",
        h.newDevice(),
      );
      expect(instead.body.name).toBe("PASSKEY_PASSWORD_PROOF");
      expect((await browser.list()).items).toHaveLength(1);
    });

    it("clears the challenge after a write, so the response cannot be posted twice", async ({
      expect,
    }) => {
      const h = await boot();
      const browser = await h.signIn(await h.user());
      const proof = { currentPassword: "Secret-123" };

      const options = await browser.call(
        "POST",
        "/api/users/me/passkeys/options",
      );
      const credential = await h.device.create(options.body);
      const first = await browser.call("POST", "/api/users/me/passkeys", {
        credential,
        proof,
      });
      expect(first.status).toBe(200);
      const again = await browser.call("POST", "/api/users/me/passkeys", {
        credential,
        proof,
      });
      expect(again.body.name).toBe("PASSKEY_CHALLENGE");
    });

    it("asks a passkey-only account for a user-verified assertion from its own passkeys", async ({
      expect,
    }) => {
      const h = await boot();
      const browser = await h.signIn(await h.user(), { dropPassword: true });

      // No password and no passkey: the session alone.
      expect((await browser.list()).proof).toBe("none");
      expect((await browser.addPasskey()).status).toBe(200);
      expect((await browser.list()).proof).toBe("passkey");

      const phone = h.newDevice();
      expect(
        (await browser.addPasskey(undefined, "Phone", phone)).body.name,
      ).toBe("PASSKEY_ASSERTION_PROOF");

      const unverified = await browser.stepUp({ userVerified: false });
      expect(
        (await browser.addPasskey({ assertion: unverified }, "Phone", phone))
          .body.data.reason,
      ).toBe("invalid");

      // Step-up by the first passkey, then a second one is added.
      const proof = await browser.stepUp();
      const second = await browser.addPasskey(
        { assertion: proof },
        "Phone",
        phone,
      );
      expect(second.status).toBe(200);
      const list = await browser.list();
      expect(list.items.map((it) => it.name)).toEqual(["Laptop", "Phone"]);
      expect(list.items[0].lastUsedAt).toBeDefined();
    });

    it("refuses a proof signed by another account's passkey", async ({
      expect,
    }) => {
      const h = await boot();
      const alice = await h.signIn(await h.user(), { dropPassword: true });
      await alice.addPasskey();
      const bob = await h.signIn(await h.user(), { dropPassword: true });
      const bobDevice = h.newDevice();
      await bob.addPasskey(undefined, "Bob's", bobDevice);
      const bobCredential = bobDevice.credentials()[0]!;

      // Alice's step-up challenge, answered by Bob's passkey.
      const options = await alice.call(
        "POST",
        "/api/users/me/passkeys/proof/options",
      );
      const assertion = await bobDevice.get(
        { ...options.body, allowCredentials: [] },
        { credentialId: bobCredential.id },
      );
      const refused = await alice.addPasskey(
        { assertion },
        "Second",
        h.newDevice(),
      );
      expect(refused.body.name).toBe("PASSKEY_ASSERTION_PROOF");
      expect(refused.body.data.reason).toBe("invalid");
    });

    it("passes on the session alone when the only passkey is unusable here", async ({
      expect,
    }) => {
      const h = await boot();
      const user = await h.user();
      const browser = await h.signIn(user, { dropPassword: true });
      await h.realm.identityRepository().create({
        userId: user.id,
        provider: "passkey",
        providerUserId: "b3RoZXItaG9zdA",
        providerData: {
          publicKey: {
            kty: "EC",
            alg: "ES256",
            crv: "P-256",
            x: "AA",
            y: "AA",
          },
          signCount: 0,
          transports: [],
          aaguid: "00000000-0000-0000-0000-000000000000",
          backupEligible: false,
          backedUp: false,
          rpId: "other.example.test",
          name: "Old host",
          createdAt: new Date().toISOString(),
        },
      });

      const list = await browser.list();
      expect(list.proof).toBe("none");
      expect(list.items[0]).toMatchObject({ name: "Old host", usable: false });
      expect((await browser.addPasskey()).status).toBe(200);
    });

    it("never removes the last way to sign in, and counts a usable passkey as one", async ({
      expect,
    }) => {
      const h = await boot();
      const user = await h.user();
      const browser = await h.signIn(user);
      await browser.addPasskey({ currentPassword: "Secret-123" });
      const [passkey] = (await browser.list()).items;

      // /users/me/identities neither lists the passkey nor unlinks it.
      const identities = await browser.call("GET", "/api/users/me/identities");
      expect(identities.body.map((it: any) => it.provider)).toEqual([
        "credentials",
      ]);
      expect(
        (await browser.call("DELETE", `/api/users/me/identities/${passkey.id}`))
          .status,
      ).toBe(404);

      // The password may go: the passkey is a way in.
      const unlinked = await browser.call(
        "DELETE",
        `/api/users/me/identities/${identities.body[0].id}`,
      );
      expect(unlinked.status).toBe(200);

      // Now the passkey is the last one.
      const proof = await browser.stepUp();
      const last = await browser.call(
        "DELETE",
        `/api/users/me/passkeys/${passkey.id}`,
        { proof: { assertion: proof } },
      );
      expect(last.body.name).toBe("LAST_SIGN_IN_METHOD");
    });

    it("renames and removes only the caller's own passkeys", async ({
      expect,
    }) => {
      const h = await boot();
      const alice = await h.signIn(await h.user());
      await alice.addPasskey({ currentPassword: "Secret-123" });
      const [passkey] = (await alice.list()).items;
      const bob = await h.signIn(await h.user());

      expect(
        (
          await bob.call("PATCH", `/api/users/me/passkeys/${passkey.id}`, {
            name: "Mine now",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await bob.call("DELETE", `/api/users/me/passkeys/${passkey.id}`, {
            proof: { currentPassword: "Secret-123" },
          })
        ).status,
      ).toBe(404);

      await alice.call("PATCH", `/api/users/me/passkeys/${passkey.id}`, {
        name: "Work laptop",
      });
      expect((await alice.list()).items[0].name).toBe("Work laptop");

      const wrong = await alice.call(
        "DELETE",
        `/api/users/me/passkeys/${passkey.id}`,
        { proof: { currentPassword: "nope" } },
      );
      expect(wrong.body.name).toBe("PASSKEY_PASSWORD_PROOF");
      const removed = await alice.call(
        "DELETE",
        `/api/users/me/passkeys/${passkey.id}`,
        { proof: { currentPassword: "Secret-123" } },
      );
      expect(removed.status).toBe(200);
      expect((await alice.list()).items).toHaveLength(0);
    });

    it("refuses enrolment on a realm with passkeys off, and still lists", async ({
      expect,
    }) => {
      const h = await boot({ settings: { passkeys: "disabled" } });
      const browser = await h.signIn(await h.user());

      const refused = await browser.call(
        "POST",
        "/api/users/me/passkeys/options",
      );
      expect(refused.body.name).toBe("PASSKEYS_DISABLED");
      expect((await browser.list()).items).toEqual([]);
    });

    it("caps an account at ten passkeys", async ({ expect }) => {
      const h = await boot();
      const user = await h.user();
      const browser = await h.signIn(user);
      const cap = h.alepha.inject(PasskeyService).maxPerUser;
      for (let i = 0; i < cap; i++) {
        await h.realm.identityRepository().create({
          userId: user.id,
          provider: "passkey",
          providerUserId: `cap-${i}-${user.id}`,
          providerData: { rpId: "localhost", name: `#${i}`, transports: [] },
        });
      }
      const refused = await browser.call(
        "POST",
        "/api/users/me/passkeys/options",
      );
      expect(refused.body.name).toBe("PASSKEY_LIMIT");
    });

    it("refuses a credential another account already enrolled", async ({
      expect,
    }) => {
      const h = await boot();
      const browser = await h.signIn(await h.user(), { dropPassword: true });
      const other = await h.user();
      const options = await browser.call(
        "POST",
        "/api/users/me/passkeys/options",
      );
      const credential = await h.device.create(options.body);
      await h.realm.identityRepository().create({
        userId: other.id,
        provider: "passkey",
        providerUserId: credential.id,
        providerData: {},
      });
      const conflict = await browser.call("POST", "/api/users/me/passkeys", {
        credential,
      });
      expect(conflict.status).toBe(409);
      expect(conflict.body.name).toBe("PASSKEY_CONFLICT");
    });
  },
);

describe("alepha/api/users - PasskeyService.authenticate", () => {
  it("refuses a passkey whose owner belongs to another realm", async ({
    expect,
  }) => {
    const h = await PasskeyHarness.boot({ secondRealm: "staff" });
    const browser = await h.signIn(await h.user(), { dropPassword: true });
    await browser.addPasskey();
    const service = h.alepha.inject(PasskeyService);
    const url = new URL(h.hostname);
    const rp = {
      rpId: url.hostname,
      name: "x",
      origin: { host: url.host },
    };
    const challenge = "c3RhZmYtcmVhbG0";
    const assertion = await h.device.get({ challenge, rpId: url.hostname });

    // Same credential, asked for in the other realm: identities carry no
    // realm, so the owner's realm decides.
    await expect(
      service.authenticate(assertion, { realm: "staff", challenge, rp }),
    ).rejects.toThrow("Passkey of another realm");
    const ok = await service.authenticate(
      await h.device.get({ challenge, rpId: url.hostname }),
      { challenge, rp },
    );
    expect(ok.user.id).toBe(browser.userId);
  });
});

describe("alepha/api/users - passkey settings", () => {
  it("reads a stored settings parameter with no passkeys key as disabled", async ({
    expect,
  }) => {
    const h = await PasskeyHarness.boot({
      settings: { passkeys: "disabled" },
      features: { parameters: true },
    });
    const realm = h.realm.getRealm();
    const current = await realm.getSettings();
    const { passkeys: _, ...stored } = current;
    await realm.settingsParameter!.set(stored as never);
    expect((await realm.getSettings()).passkeys ?? "disabled").toBe("disabled");

    const browser = await h.signIn(await h.user());
    expect(
      (await browser.call("POST", "/api/users/me/passkeys/options")).body.name,
    ).toBe("PASSKEYS_DISABLED");
  });

  it("keeps passkeyRelyingParty out of the public realm config", async ({
    expect,
  }) => {
    const h = await PasskeyHarness.boot({
      settings: {
        passkeyRelyingParty: {
          id: "example.test",
          origins: ["https://example.test"],
        },
      },
    });
    // What `/realms/config` serializes the settings through.
    const settings = h.alepha.codec.encode(
      publicRealmSettingsSchema,
      h.realm.getRealm().settings,
    ) as Record<string, unknown>;
    expect(settings.passkeys).toBe("optional");
    expect(settings.passkeyRelyingParty).toBeUndefined();
    expect(h.realm.getRealm().settings.passkeyRelyingParty?.id).toBe(
      "example.test",
    );
  });

  it("audits add, rename and remove, and emails on add and remove only", async ({
    expect,
  }) => {
    const h = await PasskeyHarness.boot({ features: { notifications: true } });
    const browser = await h.signIn(await h.user());
    await browser.addPasskey({ currentPassword: "Secret-123" });
    const [passkey] = (await browser.list()).items;
    await browser.call("PATCH", `/api/users/me/passkeys/${passkey.id}`, {
      name: "Renamed",
    });
    await browser.call("DELETE", `/api/users/me/passkeys/${passkey.id}`, {
      proof: { currentPassword: "Secret-123" },
    });

    await expect.poll(() => h.email.records.length).toBe(2);
    const subjects = h.email.records
      .map((it: any) => String(it.subject))
      .sort((a, b) => a.localeCompare(b));
    expect(subjects).toEqual([
      "A passkey was added to your account",
      "A passkey was removed from your account",
    ]);
    expect(String(h.email.records[0].body)).toContain("Laptop");
  });
});
