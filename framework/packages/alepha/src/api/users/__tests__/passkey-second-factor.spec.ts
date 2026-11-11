import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { MfaService } from "../services/MfaService.ts";
import { TotpService } from "../services/TotpService.ts";
import { type PasskeyBrowser, PasskeyHarness } from "./passkeyHarness.ts";

const drivers = [
  ["SQLite", "sqlite://:memory:"],
  ["Postgres", undefined],
] as const;

/**
 * A user with a password, a passkey on `device`, and TOTP when asked.
 */
const account = async (
  h: PasskeyHarness,
  options: { totp?: boolean; device?: PasskeyHarness["device"] } = {},
) => {
  const user = await h.user();
  const browser = await h.signIn(user);
  await browser.addPasskey(
    { currentPassword: user.password },
    "Laptop",
    options.device ?? h.device,
  );
  if (options.totp) {
    const mfa = h.alepha.inject(MfaService);
    const totp = h.alepha.inject(TotpService);
    const enrollment = await mfa.beginTotpEnrollment(user.id);
    await mfa.activateTotp(
      user.id,
      totp.codeForCounter(enrollment.secret, totp.currentStep()),
    );
  }
  return { user, browser };
};

const passwordLogin = (
  visitor: PasskeyBrowser,
  user: { email: string; password: string },
) =>
  visitor.call("POST", "/_auth/token?provider=credentials", {
    username: user.email,
    password: user.password,
  });

describe.each(drivers)(
  "alepha/server/auth - a passkey clears the second factor on %s",
  (_, databaseUrl) => {
    const boot = (settings: Partial<RealmAuthSettings> = {}) =>
      PasskeyHarness.boot({
        databaseUrl,
        settings: {
          mfa: { totp: "optional", emailCode: "disabled" },
          ...settings,
        },
      });

    it("clears the step after a password with the user's own passkey", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await account(h, { totp: true });
      const visitor = h.anonymous();

      const step = await passwordLogin(visitor, user);
      expect(step.status).toBe(401);
      expect(step.body.name).toBe("MFA_REQUIRED");
      expect(step.body.data.methods).toEqual(["totp"]);
      expect(step.body.data.passkey).toBe(true);
      const challenge = step.body.data.challenge;

      const options = await visitor.call("POST", "/_auth/passkey/options", {
        challenge,
      });
      expect(options.body.userVerification).toBe("required");
      expect(options.body.allowCredentials).toHaveLength(1);

      const credential = await h.device.get(options.body);
      const done = await visitor.call("POST", "/_auth/passkey/verify", {
        credential,
        challenge,
      });
      expect(done.status).toBe(200);
      expect(done.body.user.id).toBe(user.id);
      // Minted as `/_auth/mfa` does: the challenge's own provider.
      expect(done.body.provider).toBe("credentials");
    });

    it("refuses another account's passkey, an unverified one, and a forged or expired challenge", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await account(h, { totp: true });
      const bobDevice = h.newDevice();
      await account(h, { device: bobDevice });
      const visitor = h.anonymous();
      const challenge = (await passwordLogin(visitor, user)).body.data
        .challenge;

      const attempt = async (
        body: Record<string, unknown>,
        get: (options: any) => Promise<unknown>,
        optionsBody: Record<string, unknown> = { challenge },
      ) => {
        const options = await visitor.call(
          "POST",
          "/_auth/passkey/options",
          optionsBody,
        );
        if (options.status !== 200) {
          return options;
        }
        return visitor.call("POST", "/_auth/passkey/verify", {
          credential: await get(options.body),
          ...body,
        });
      };

      const bob = await attempt({ challenge }, (options) =>
        bobDevice.get({ ...options, allowCredentials: [] }),
      );
      expect(bob.body.name).toBe("INVALID_PASSKEY");

      const unverified = await attempt({ challenge }, (options) =>
        h.device.get(options, { userVerified: false }),
      );
      expect(unverified.body.name).toBe("INVALID_PASSKEY");

      const forged = await attempt(
        { challenge: `${challenge.slice(0, -2)}xx` },
        (options) => h.device.get(options),
      );
      expect(forged.body.name).toBe("INVALID_PASSKEY");
      const forgedOptions = await visitor.call(
        "POST",
        "/_auth/passkey/options",
        { challenge: "bm90LmEuY2hhbGxlbmdl" },
      );
      expect(forgedOptions.body.name).toBe("INVALID_PASSKEY");

      // The options were for this pending login; past five minutes it is gone.
      const options = await visitor.call("POST", "/_auth/passkey/options", {
        challenge,
      });
      const credential = await h.device.get(options.body);
      await h.alepha.inject(DateTimeProvider).travel([6, "minutes"]);
      const expired = await visitor.call("POST", "/_auth/passkey/verify", {
        credential,
        challenge,
      });
      expect(expired.body.name).toBe("INVALID_PASSKEY");
    });

    it("says nothing about passkeys before the password is right", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await account(h, { totp: true });
      const wrong = await passwordLogin(h.anonymous(), {
        ...user,
        password: "Wrong-123",
      });
      expect(wrong.status).toBe(401);
      expect(JSON.stringify(wrong.body)).not.toContain("passkey");
    });

    it("spends the user's second-factor budget", async ({ expect }) => {
      const h = await boot({
        loginRateLimit: {
          ipMaxAttempts: 50,
          accountMaxAttempts: 2,
          windowMs: 60_000,
        },
      });
      const { user } = await account(h, { totp: true });
      const visitor = h.anonymous();
      const challenge = (await passwordLogin(visitor, user)).body.data
        .challenge;
      const tryOnce = async (knobs: Record<string, unknown>) => {
        const options = await visitor.call("POST", "/_auth/passkey/options", {
          challenge,
        });
        return visitor.call("POST", "/_auth/passkey/verify", {
          credential: await h.device.get(options.body, knobs),
          challenge,
        });
      };
      await tryOnce({ tamper: "signature" });
      await tryOnce({ tamper: "signature" });
      const blocked = await tryOnce({});
      expect(blocked.body.name).toBe("INVALID_PASSKEY");
    });

    it("offers no passkey to a user who has none", async ({ expect }) => {
      const h = await boot();
      const user = await h.user();
      const mfa = h.alepha.inject(MfaService);
      const totp = h.alepha.inject(TotpService);
      const enrollment = await mfa.beginTotpEnrollment(user.id);
      await mfa.activateTotp(
        user.id,
        totp.codeForCounter(enrollment.secret, totp.currentStep()),
      );
      const step = await passwordLogin(h.anonymous(), user);
      expect(step.body.data.passkey).toBe(false);
    });

    it.for(["optional", "required"] as const)(
      "lets a password and a passkey with no TOTP sign in on the password alone, in a %s realm",
      async (requirement, { expect }) => {
        const h = await boot({
          mfa: { totp: requirement, emailCode: "disabled" },
        });
        const { user, browser } = await account(h);

        // A passkey alone raises no step, and is not an enrolment.
        const signedIn = await passwordLogin(h.anonymous(), user);
        expect(signedIn.status).toBe(200);
        expect(signedIn.body.access_token).toBeTruthy();
        const status = await browser.call("GET", "/api/users/me/mfa");
        expect(status.body.totp.enabled).toBe(false);
      },
    );
  },
);
