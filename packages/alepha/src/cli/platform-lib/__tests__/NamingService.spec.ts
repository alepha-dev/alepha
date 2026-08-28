import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { NamingService } from "../services/NamingService.ts";

describe("NamingService", () => {
  const createService = () => {
    const alepha = Alepha.create();
    return alepha.inject(NamingService);
  };

  const createNaming = (project: string, env: string, tenant?: string) =>
    createService().forContext(project, env, tenant);

  // ─────────────────────────────────────────────────────────────────────────────
  // slugify
  // ─────────────────────────────────────────────────────────────────────────────

  describe("slugify", () => {
    it("should lowercase the input", () => {
      const naming = createService();

      expect(naming.slugify("HELLO")).toBe("hello");
      expect(naming.slugify("MyApp")).toBe("myapp");
    });

    it("should replace non-alphanumeric characters with dashes", () => {
      const naming = createService();

      expect(naming.slugify("hello world")).toBe("hello-world");
      expect(naming.slugify("hello_world")).toBe("hello-world");
      expect(naming.slugify("hello.world")).toBe("hello-world");
    });

    it("should trim leading and trailing dashes", () => {
      const naming = createService();

      expect(naming.slugify("--hello--")).toBe("hello");
      expect(naming.slugify("___hello___")).toBe("hello");
      expect(naming.slugify("...hello...")).toBe("hello");
    });

    it("should truncate to 63 characters", () => {
      const naming = createService();
      const long = "a".repeat(100);

      expect(naming.slugify(long)).toBe("a".repeat(63));
      expect(naming.slugify(long).length).toBe(63);
    });

    it("should handle path-like strings such as tmp/bug001", () => {
      const naming = createService();

      expect(naming.slugify("tmp/bug001")).toBe("tmp-bug001");
    });

    it("should collapse consecutive non-alphanumeric characters into a single dash", () => {
      const naming = createService();

      expect(naming.slugify("hello---world")).toBe("hello-world");
      expect(naming.slugify("hello___world")).toBe("hello-world");
      expect(naming.slugify("a@#$b")).toBe("a-b");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // standalone (no app)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("standalone (no app)", () => {
    it("should generate correct worker name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.worker()).toBe("acme-portal-production");
    });

    it("should generate correct d1 name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.d1()).toBe("acme-portal-production");
    });

    it("should generate correct r2 name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.r2()).toBe("acme-portal-production");
    });

    it("should generate correct analytics name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.analytics()).toBe("acme-portal-production");
    });

    it("should generate correct kv name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.kv()).toBe("acme-portal-production");
    });

    it("should generate correct queue name", () => {
      const ctx = createNaming("acme-portal", "production");

      expect(ctx.queue()).toBe("acme-portal-production");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // env slugification
  // ─────────────────────────────────────────────────────────────────────────────

  describe("env slugification", () => {
    it("should slugify env with path-like characters", () => {
      const ctx = createNaming("acme-portal", "tmp/bug001");

      expect(ctx.worker()).toBe("acme-portal-tmp-bug001");
      expect(ctx.d1()).toBe("acme-portal-tmp-bug001");
      expect(ctx.r2()).toBe("acme-portal-tmp-bug001");
      expect(ctx.analytics()).toBe("acme-portal-tmp-bug001");
      expect(ctx.kv()).toBe("acme-portal-tmp-bug001");
      expect(ctx.queue()).toBe("acme-portal-tmp-bug001");
    });

    it("should slugify env with uppercase characters", () => {
      const ctx = createNaming("acme-portal", "STAGING");

      expect(ctx.worker()).toBe("acme-portal-staging");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // tenant prefix
  // ─────────────────────────────────────────────────────────────────────────────

  describe("tenant prefix", () => {
    it("prefixes every resource with the tenant slug", () => {
      const ctx = createNaming("club", "production", "b14");

      expect(ctx.worker()).toBe("b14-club-production");
      expect(ctx.d1()).toBe("b14-club-production");
      expect(ctx.r2()).toBe("b14-club-production");
      expect(ctx.analytics()).toBe("b14-club-production");
      expect(ctx.kv()).toBe("b14-club-production");
      expect(ctx.queue()).toBe("b14-club-production");
    });

    it("omits the tenant segment when no tenant is given", () => {
      expect(createNaming("club", "production").worker()).toBe(
        "club-production",
      );
    });

    it("slugifies the tenant segment too", () => {
      expect(createNaming("club", "production", "B14").worker()).toBe(
        "b14-club-production",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // resolveTenant (tenancy matrix)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("resolveTenant", () => {
    it("none (default): no tenant is fine, a tenant errors", () => {
      expect(
        createService().resolveTenant(undefined, undefined),
      ).toBeUndefined();
      expect(createService().resolveTenant("none", undefined)).toBeUndefined();
      expect(() => createService().resolveTenant("none", "b14")).toThrow(
        AlephaError,
      );
    });

    it("required: tenant mandatory", () => {
      expect(createService().resolveTenant("required", "b14")).toBe("b14");
      expect(() =>
        createService().resolveTenant("required", undefined),
      ).toThrow(AlephaError);
    });

    it("optional: both base and tenant instances allowed", () => {
      expect(
        createService().resolveTenant("optional", undefined),
      ).toBeUndefined();
      expect(createService().resolveTenant("optional", "b14")).toBe("b14");
    });

    it("rejects a non-slug tenant value", () => {
      expect(() => createService().resolveTenant("required", "B14")).toThrow(
        AlephaError,
      );
      expect(() =>
        createService().resolveTenant("required", "b14.club"),
      ).toThrow(AlephaError);
      expect(() => createService().resolveTenant("required", "-b14")).toThrow(
        AlephaError,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // tenantDomain
  // ─────────────────────────────────────────────────────────────────────────────

  describe("tenantDomain", () => {
    it("prepends the tenant as the leftmost DNS label", () => {
      expect(createService().tenantDomain("alepha.club", "b14")).toBe(
        "b14.alepha.club",
      );
      expect(createService().tenantDomain("club.alepha.dev", "sandbox")).toBe(
        "sandbox.club.alepha.dev",
      );
    });

    it("returns the base domain unchanged with no tenant", () => {
      expect(createService().tenantDomain("alepha.club", undefined)).toBe(
        "alepha.club",
      );
    });

    it("an override wins outright (V2 custom domain seam)", () => {
      expect(
        createService().tenantDomain(
          "alepha.club",
          "b14",
          "reservation.club-b14.fr",
        ),
      ).toBe("reservation.club-b14.fr");
    });

    it("passes through an undefined base", () => {
      expect(createService().tenantDomain(undefined, "b14")).toBeUndefined();
    });
  });
});
