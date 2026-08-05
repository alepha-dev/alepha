import { Alepha, z } from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { $cookie, AlephaServerCookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";
// Relative, never `alepha/bucket`: a file inside the module importing its own
// public barrel is a `bucket -> bucket` cycle that only `yarn build` catches.
import { R2FileStorageProvider } from "../providers/R2FileStorageProvider.ts";
import { S3FileStorageProvider } from "../providers/S3FileStorageProvider.ts";

/**
 * `APP_NAME` used to be the only key prefix, which made it the obvious variable
 * for a host to set when it wants each app's blobs in their own directory of a
 * shared bucket.
 *
 * It is the wrong one. `APP_NAME` also namespaces **cookies**
 * (`ServerCookiesProvider.prefixName`) and the `Server-Timing` header, so a host
 * that repurposed it to lay out object storage would log every user out as a
 * side effect. And an app may set `APP_NAME` itself — `Alepha.create` spreads
 * `{...process.env, ...state.env}`, so the in-code value wins — which means a
 * host can never be sure the value it exported is the one keying its objects.
 *
 * `S3_KEY_PREFIX` exists so the two can be decided separately. Unset, nothing
 * changes.
 */

const s3Env = {
  S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  S3_BUCKET_NAME: "bay-blobs",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

const s3Prefix = (env: Record<string, string>) =>
  Alepha.create({ env: { ...s3Env, ...env } }).inject(S3FileStorageProvider)
    .prefix;

const r2Prefix = (env: Record<string, string>) =>
  Alepha.create({ env: { R2_BUCKET_NAME: "bay-blobs", ...env } }).inject(
    R2FileStorageProvider,
  ).prefix;

describe("blob key prefix", () => {
  describe("S3FileStorageProvider", () => {
    it("should key objects under S3_KEY_PREFIX when set", () => {
      expect(s3Prefix({ S3_KEY_PREFIX: "apps/lore/production/blobs" })).toBe(
        "apps/lore/production/blobs",
      );
    });

    it("should let S3_KEY_PREFIX win over APP_NAME", () => {
      expect(
        s3Prefix({
          APP_NAME: "lore-production",
          S3_KEY_PREFIX: "apps/lore/production/blobs",
        }),
      ).toBe("apps/lore/production/blobs");
    });

    it("should fall back to APP_NAME when S3_KEY_PREFIX is absent", () => {
      // Backward compatibility is the whole reason this is a fallback and not
      // a replacement: every app already deployed keys its objects under
      // APP_NAME, and those objects do not move.
      expect(s3Prefix({ APP_NAME: "RDM" })).toBe("RDM");
    });

    it("should have no prefix when neither is set", () => {
      expect(s3Prefix({})).toBeUndefined();
    });
  });

  describe("R2FileStorageProvider", () => {
    // The two layouts are documented as identical — "the same scheme as
    // R2FileStorageProvider" — so a container means the same thing on every
    // backend. Letting them drift is how that stops being true.
    it("should key objects under S3_KEY_PREFIX when set", () => {
      expect(r2Prefix({ S3_KEY_PREFIX: "apps/lore/production/blobs" })).toBe(
        "apps/lore/production/blobs",
      );
    });

    it("should let S3_KEY_PREFIX win over APP_NAME", () => {
      expect(
        r2Prefix({
          APP_NAME: "lore-production",
          S3_KEY_PREFIX: "apps/lore/production/blobs",
        }),
      ).toBe("apps/lore/production/blobs");
    });

    it("should fall back to APP_NAME when S3_KEY_PREFIX is absent", () => {
      expect(r2Prefix({ APP_NAME: "RDM" })).toBe("RDM");
    });

    it("should have no prefix when neither is set", () => {
      expect(r2Prefix({})).toBeUndefined();
    });
  });

  /**
   * The reason `S3_KEY_PREFIX` exists at all, pinned so it cannot be quietly
   * undone. This asserts an invariant rather than driving new behaviour: it was
   * verified to FAIL against a provider that reads `APP_NAME` only, which is
   * the exact regression it guards.
   *
   * A host laying out object storage must be able to do so without touching
   * the cookie jar. Anyone who "simplifies" the provider back to `APP_NAME`
   * forces that host to set `APP_NAME` instead — and the first deploy after
   * that renames every cookie and ends every session.
   */
  describe("decoupling from the cookie namespace", () => {
    const COOKIE_SECRET = "DCf6DvpLAfwy8XdPRucMO4tPS6dVCHob";

    class TokenApp {
      tokens = $cookie({
        name: "tokens",
        schema: z.object({ value: z.text() }),
      });
      set = $action({
        handler: () => {
          this.tokens.set({ value: "from-app" });
        },
      });
    }

    const setCookieHeaderFor = async (env: Record<string, string>) => {
      const alepha = Alepha.create({ env: { COOKIE_SECRET, ...env } })
        .with(AlephaServer)
        .with(AlephaServerCookies)
        .with(TokenApp);
      await alepha.start();
      const response = await alepha.inject(TokenApp).set.fetch();
      return response.headers.get("set-cookie");
    };

    it("should not namespace cookies when only S3_KEY_PREFIX is set", async () => {
      const header = await setCookieHeaderFor({
        S3_KEY_PREFIX: "apps/lore/production/blobs",
      });

      // Bare name — the blob layout said nothing about the cookie jar.
      expect(header).toMatch(/(^|; )tokens=/);
      expect(header).not.toContain("apps/lore/production/blobs");
    });

    it("should keep the two prefixes independent when a host sets both", async () => {
      // What Bay actually writes into a deployed app's environment.
      const env = {
        APP_NAME: "lore-production",
        S3_KEY_PREFIX: "apps/lore/production/blobs",
      };

      // Blobs follow S3_KEY_PREFIX...
      expect(s3Prefix(env)).toBe("apps/lore/production/blobs");
      // ...cookies follow APP_NAME, and neither leaks into the other.
      const header = await setCookieHeaderFor(env);
      expect(header).toContain("lore-production.tokens=");
      expect(header).not.toContain("apps/lore/production/blobs");
    });
  });
});
