import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaServerAuth } from "../index.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

class ProviderProbe extends ServerAuthProvider {
  public probeValidate(uri: string) {
    return this.validateRedirectUri(uri);
  }
}

const setup = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({ env });
  alepha.with(AlephaServerAuth);
  alepha.with(ProviderProbe);
  await alepha.start();
  return alepha.inject(ProviderProbe);
};

describe("validateRedirectUri", () => {
  describe("without COOKIE_PARENT_DOMAIN (legacy behaviour)", () => {
    it("accepts relative paths", async ({ expect }) => {
      const p = await setup({});
      expect(p.probeValidate("/admin")).toBe("/admin");
    });
    it("rejects protocol-relative URLs", async ({ expect }) => {
      const p = await setup({});
      expect(p.probeValidate("//evil.com")).toBe("/");
    });
    it("rejects absolute URLs", async ({ expect }) => {
      const p = await setup({});
      expect(p.probeValidate("https://evil.com/x")).toBe("/");
    });
  });

  describe("with COOKIE_PARENT_DOMAIN=.club.alepha.dev", () => {
    const env = { COOKIE_PARENT_DOMAIN: ".club.alepha.dev" };
    it("still accepts relative paths", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("/admin")).toBe("/admin");
    });
    it("still rejects protocol-relative URLs", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("//evil.com")).toBe("/");
    });
    it("rejects unrelated absolute URLs", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("https://evil.com/x")).toBe("/");
    });
    it("rejects http (must be https)", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("http://viscapadel.club.alepha.dev/admin")).toBe(
        "/",
      );
    });
    it("accepts subdomain under the parent domain", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("https://viscapadel.club.alepha.dev/admin")).toBe(
        "https://viscapadel.club.alepha.dev/admin",
      );
    });
    it("accepts the bare parent domain", async ({ expect }) => {
      const p = await setup(env);
      expect(p.probeValidate("https://club.alepha.dev/dashboard")).toBe(
        "https://club.alepha.dev/dashboard",
      );
    });
    it("rejects look-alike domains (suffix match without dot boundary)", async ({
      expect,
    }) => {
      const p = await setup(env);
      expect(p.probeValidate("https://notclub.alepha.dev/x")).toBe("/");
      expect(
        p.probeValidate("https://evil-club.alepha.dev.attacker.com/x"),
      ).toBe("/");
    });
  });
});
