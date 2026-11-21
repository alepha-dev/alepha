import { describe, expect, it } from "vitest";

import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";
import { publicRealmSettingsSchema } from "./realmConfigSchema.ts";

describe("publicRealmSettingsSchema", () => {
  const keys = Object.keys(publicRealmSettingsSchema.shape);

  it("names only settings of the atom", () => {
    const fullKeys = Object.keys(realmAuthSettingsAtom.schema.shape);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(fullKeys).toContain(key);
    }
  });

  it("carries the fields the login and registration pages read", () => {
    for (const key of [
      "registrationAllowed",
      "passwordPolicy",
      "username",
      "usernameRegExp",
      "resetPasswordAllowed",
      "captchaRequired",
      "mfa",
      "passkeys",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("leaves out the admin lists, the brute-force budgets and the server configuration", () => {
    for (const key of [
      "adminEmails",
      "adminUsernames",
      "loginRateLimit",
      "registrationIpMaxAttempts",
      "usernameBlocklist",
      "defaultRoles",
      "trustProviderEmail",
      "verifyEmailUrl",
      "refreshToken",
      "passkeyRelyingParty",
    ]) {
      // Each is a setting of the atom: a rename there fails here.
      expect(Object.keys(realmAuthSettingsAtom.schema.shape)).toContain(key);
      expect(keys).not.toContain(key);
    }
  });
});
