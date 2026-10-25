import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { NamingService } from "../services/NamingService.ts";

describe("NamingService", () => {
  const createService = () => {
    const alepha = Alepha.create();
    return alepha.inject(NamingService);
  };

  const createNaming = (project: string, env: string) =>
    createService().forContext(project, env);

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
});
