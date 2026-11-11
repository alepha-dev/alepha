import { MfaRequiredError, ReactAuth } from "alepha/react/auth";
import { currentUserAtom } from "alepha/security";
import { MemoryPasskeyClient } from "alepha/testing/webauthn";
import { describe, it } from "vitest";

import { MfaService } from "../services/MfaService.ts";
import { TotpService } from "../services/TotpService.ts";
import { PasskeyHarness } from "./passkeyHarness.ts";

/**
 * The whole flow from the client's side: a passkey added through the
 * account routes, then `ReactAuth.loginPasskey` against the real realm,
 * with `MemoryPasskeyClient` standing in for the browser. The `@alepha/ui`
 * browser specs mount React modules only, so the end-to-end proof from add
 * to sign-in lives here, in node.
 */
describe("alepha/react/auth - ReactAuth.loginPasskey against a realm", () => {
  const boot = () =>
    PasskeyHarness.boot({
      databaseUrl: "sqlite://:memory:",
      reactAuth: true,
      settings: { mfa: { totp: "optional", emailCode: "disabled" } },
    });

  it("signs in with a passkey added through the account routes", async ({
    expect,
  }) => {
    const h = await boot();
    const user = await h.user();
    await (await h.signIn(user)).addPasskey({ currentPassword: user.password });

    const tokens = await h.alepha
      .inject(ReactAuth)
      .loginPasskey({ hostname: h.hostname });
    expect(tokens?.access_token).toBeTruthy();
    expect(h.alepha.store.get(currentUserAtom)?.id).toBe(user.id);
  });

  it("resolves undefined and signs nobody in when the ceremony is dismissed", async ({
    expect,
  }) => {
    const h = await boot();
    const user = await h.user();
    await (await h.signIn(user)).addPasskey({ currentPassword: user.password });
    h.alepha.inject(MemoryPasskeyClient).cancelNext = true;

    const tokens = await h.alepha
      .inject(ReactAuth)
      .loginPasskey({ hostname: h.hostname });
    expect(tokens).toBeUndefined();
    expect(h.alepha.store.get(currentUserAtom)).toBeUndefined();
  });

  it("clears a pending second factor with the challenge", async ({
    expect,
  }) => {
    const h = await boot();
    const user = await h.user();
    await (await h.signIn(user)).addPasskey({ currentPassword: user.password });
    const mfa = h.alepha.inject(MfaService);
    const totp = h.alepha.inject(TotpService);
    const enrollment = await mfa.beginTotpEnrollment(user.id);
    await mfa.activateTotp(
      user.id,
      totp.codeForCounter(enrollment.secret, totp.currentStep()),
    );

    const auth = h.alepha.inject(ReactAuth);
    const error = await auth
      .login("credentials", {
        username: user.email,
        password: user.password,
        hostname: h.hostname,
      })
      .catch((it) => it);
    expect(error).toBeInstanceOf(MfaRequiredError);
    expect(error.data.passkey).toBe(true);

    const tokens = await auth.loginPasskey({
      challenge: error.data.challenge,
      hostname: h.hostname,
    });
    expect(tokens?.access_token).toBeTruthy();
    expect(h.alepha.store.get(currentUserAtom)?.id).toBe(user.id);
  });
});
