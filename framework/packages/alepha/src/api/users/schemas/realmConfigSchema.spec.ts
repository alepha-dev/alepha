import { describe, expect, it } from "vitest";

import { realmAuthSettingsAtom } from "../atoms/realmAuthSettingsAtom.ts";
import { publicRealmSettingsSchema } from "./realmConfigSchema.ts";

describe("publicRealmSettingsSchema", () => {
  it("omits the privileged-account allowlist from the public projection", () => {
    const keys = Object.keys(publicRealmSettingsSchema.shape);
    expect(keys).not.toContain("adminEmails");
    expect(keys).not.toContain("adminUsernames");
  });

  it("still carries fields the login/registration UI needs", () => {
    const keys = Object.keys(publicRealmSettingsSchema.shape);
    expect(keys).toContain("registrationAllowed");
    expect(keys).toContain("passwordPolicy");
  });

  it("does not silently drop new sensitive fields — full settings still has them", () => {
    // Guards against the atom being refactored so the omit becomes a no-op.
    const fullKeys = Object.keys(realmAuthSettingsAtom.schema.shape);
    expect(fullKeys).toContain("adminEmails");
    expect(fullKeys).toContain("adminUsernames");
  });
});
