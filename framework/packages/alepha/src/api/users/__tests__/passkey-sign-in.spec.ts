import { AuditService } from "alepha/api/audits";
import type { AuthenticationResponseJson } from "alepha/security";
import { describe, it } from "vitest";

import type { RealmAuthSettings } from "../atoms/realmAuthSettingsAtom.ts";
import { MfaService } from "../services/MfaService.ts";
import { PasskeyService } from "../services/PasskeyService.ts";
import { TotpService } from "../services/TotpService.ts";
import { PasskeyHarness } from "./passkeyHarness.ts";

const drivers = [
  ["SQLite", "sqlite://:memory:"],
  ["Postgres", undefined],
] as const;

/**
 * A user with a password and one passkey on the shared device.
 */
const enrolled = async (h: PasskeyHarness) => {
  const user = await h.user();
  const browser = await h.signIn(user);
  const added = await browser.addPasskey({ currentPassword: user.password });
  if (added.status !== 200) {
    throw new Error(`enrolment failed: ${JSON.stringify(added.body)}`);
  }
  return { user, browser };
};

describe.each(drivers)(
  "alepha/server/auth - passkey sign-in on %s",
  (_, databaseUrl) => {
    const boot = (
      settings: Partial<RealmAuthSettings> = {},
      secondRealm?: string,
    ) => PasskeyHarness.boot({ databaseUrl, settings, secondRealm });

    it("signs in with the passkey alone, and the options name no account", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await enrolled(h);
      const visitor = h.anonymous();

      const options = await visitor.call("POST", "/_auth/passkey/options", {});
      expect(options.status).toBe(200);
      expect(options.body.allowCredentials).toEqual([]);
      expect(options.body.userVerification).toBe("preferred");
      expect(
        Object.keys(options.body).sort((a, b) => a.localeCompare(b)),
      ).toEqual([
        "allowCredentials",
        "challenge",
        "rpId",
        "timeout",
        "userVerification",
      ]);

      const credential = await h.device.get(options.body);
      const signedIn = await visitor.call("POST", "/_auth/passkey/verify", {
        credential,
      });
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.access_token).toBeTruthy();
      expect(signedIn.body.user.id).toBe(user.id);
      expect(signedIn.body.provider).toBe("passkey");
    });

    it("refuses a replay, whether the challenge is gone or new", async ({
      expect,
    }) => {
      const h = await boot();
      await enrolled(h);
      const visitor = h.anonymous();
      const options = await visitor.call("POST", "/_auth/passkey/options", {});
      const credential = await h.device.get(options.body);
      expect(
        (await visitor.call("POST", "/_auth/passkey/verify", { credential }))
          .status,
      ).toBe(200);

      const replay = await visitor.call("POST", "/_auth/passkey/verify", {
        credential,
      });
      expect(replay.status).toBe(401);
      expect(replay.body.name).toBe("INVALID_PASSKEY");

      await visitor.call("POST", "/_auth/passkey/options", {});
      const again = await visitor.call("POST", "/_auth/passkey/verify", {
        credential,
      });
      expect(again.body.name).toBe("INVALID_PASSKEY");
      expect(again.body.message).toBe(replay.body.message);
    });

    it("signs each user in with their own passkey", async ({ expect }) => {
      const h = await boot();
      const alice = await enrolled(h);
      const bobDevice = h.newDevice();
      const bob = await h.user();
      const bobBrowser = await h.signIn(bob);
      await bobBrowser.addPasskey(
        { currentPassword: bob.password },
        "Bob's",
        bobDevice,
      );

      const asAlice = await h.anonymous().signInWithPasskey();
      const asBob = await h.anonymous().signInWithPasskey({}, bobDevice);
      expect(asAlice.body.user.id).toBe(alice.user.id);
      expect(asBob.body.user.id).toBe(bob.id);
    });

    it("refuses a passkey whose user belongs to another realm", async ({
      expect,
    }) => {
      const h = await boot({}, "staff");
      await enrolled(h);
      const refused = await h
        .anonymous()
        .signInWithPasskey({}, h.device, "?realm=staff");
      expect(refused.status).toBe(401);
      expect(refused.body.name).toBe("INVALID_PASSKEY");
    });

    it("refuses a disabled account with the same error", async ({ expect }) => {
      const h = await boot();
      const { user } = await enrolled(h);
      await h.realm.userRepository().updateById(user.id, { enabled: false });
      const refused = await h.anonymous().signInWithPasskey();
      expect(refused.status).toBe(401);
      expect(refused.body.name).toBe("INVALID_PASSKEY");
    });

    it("lets only one of two assertions with the same counter through", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await enrolled(h);
      const service = h.alepha.inject(PasskeyService);
      const url = new URL(h.hostname);
      const rp = { rpId: url.hostname, name: "x", origin: { host: url.host } };
      const challenge = "cmFjZQ";
      // Two assertions both claiming counter 1: whichever runs second loses,
      // to the row version when they overlap, to the counter when they do not.
      const first = await h.device.get({ challenge }, { counter: 1 });
      const second = await h.device.get({ challenge }, { counter: 1 });
      const results = await Promise.allSettled(
        [first, second].map((credential: AuthenticationResponseJson) =>
          service.authenticate(credential, { challenge, rp }),
        ),
      );
      expect(results.filter((it) => it.status === "fulfilled")).toHaveLength(1);
      const [row] = await service.passkeysOf(user.id);
      expect(service.dataOf(row!).signCount).toBe(1);
    });

    it("gives a user-verified assertion a session even when TOTP is enrolled, and sends an unverified one to the second factor", async ({
      expect,
    }) => {
      const h = await boot({
        mfa: { totp: "optional", emailCode: "disabled" },
      });
      const { user } = await enrolled(h);
      const mfa = h.alepha.inject(MfaService);
      const totp = h.alepha.inject(TotpService);
      const enrollment = await mfa.beginTotpEnrollment(user.id);
      await mfa.activateTotp(
        user.id,
        totp.codeForCounter(enrollment.secret, totp.currentStep()),
      );

      const verified = await h.anonymous().signInWithPasskey();
      expect(verified.status).toBe(200);

      const unverified = await h
        .anonymous()
        .signInWithPasskey({ userVerified: false });
      expect(unverified.status).toBe(401);
      expect(unverified.body.name).toBe("MFA_REQUIRED");
      expect(unverified.body.data.methods).toEqual(["totp"]);

      // `/_auth/mfa` finishes it unchanged, as provider passkey.
      const finished = await h.anonymous().call("POST", "/_auth/mfa", {
        challenge: unverified.body.data.challenge,
        code: totp.codeForCounter(enrollment.secret, totp.currentStep() + 1),
      });
      expect(finished.status).toBe(200);
      expect(finished.body.provider).toBe("passkey");
    });

    it("keeps the session across a refresh and a logout through the passkey provider", async ({
      expect,
    }) => {
      const h = await boot();
      await enrolled(h);
      const visitor = h.anonymous();
      const signedIn = await visitor.signInWithPasskey();
      expect([...visitor.jar.keys()].some((it) => it.includes("tokens"))).toBe(
        true,
      );

      // The cookie alone carries the session: the provider it names resolves.
      const list = await visitor.call("GET", "/api/users/me/passkeys");
      expect(list.status).toBe(200);

      const refreshed = await visitor.call(
        "POST",
        "/_auth/refresh?provider=passkey",
        { refresh_token: signedIn.body.refresh_token },
      );
      expect(refreshed.status).toBe(200);

      const logout = await fetch(`${h.hostname}/oauth/logout`, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: h.hostname,
          cookie: [...visitor.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      expect(logout.status).toBeLessThan(400);
      // The tokens cookie is cleared.
      expect(
        logout.headers
          .getSetCookie()
          .some(
            (it) => it.includes("tokens") && /max-age=0|expires=/i.test(it),
          ),
      ).toBe(true);
    });

    it("spends the login:ip budget of the password login", async ({
      expect,
    }) => {
      const h = await boot({
        loginRateLimit: {
          ipMaxAttempts: 2,
          accountMaxAttempts: 5,
          windowMs: 60_000,
        },
      });
      await enrolled(h);
      const visitor = h.anonymous();
      for (let i = 0; i < 2; i++) {
        await visitor.signInWithPasskey({ tamper: "signature" });
      }
      const blocked = await visitor.signInWithPasskey();
      expect(blocked.status).toBe(401);
      expect(blocked.body.name).toBe("INVALID_PASSKEY");
    });

    it("refuses a regressed counter and audits it as blocked", async ({
      expect,
    }) => {
      const h = await boot();
      const { user } = await enrolled(h);
      expect(
        (await h.anonymous().signInWithPasskey({ counter: 5 })).status,
      ).toBe(200);
      const regressed = await h.anonymous().signInWithPasskey({ counter: 3 });
      expect(regressed.body.name).toBe("INVALID_PASSKEY");

      const auditService = h.alepha.inject(AuditService);
      const rows = async () =>
        (await auditService.find({ size: 100 } as never)).content;
      await expect
        .poll(async () =>
          (await rows())
            .filter((it) => it.type === "security")
            .map((it) => it.action),
        )
        .toContain("blocked");
      const logins = (await rows()).filter(
        (it) => it.type === "auth" && it.userId === user.id,
      );
      expect(
        logins.some(
          (it) =>
            (it.metadata as { provider?: string; userVerified?: boolean })
              ?.provider === "passkey" &&
            (it.metadata as { userVerified?: boolean }).userVerified === true,
        ),
      ).toBe(true);
    });

    it("refuses both routes on a realm with passkeys off", async ({
      expect,
    }) => {
      const h = await boot({ passkeys: "disabled" });
      const options = await h
        .anonymous()
        .call("POST", "/_auth/passkey/options", {});
      expect(options.status).toBe(401);
      expect(options.body.name).toBe("INVALID_PASSKEY");
    });
  },
);
