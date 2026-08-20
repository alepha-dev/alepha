import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sigilKeyBuild, sigilKeyPrefix, sigilKeyProject } from "../sigilKey.ts";

describe("sigilKey", () => {
  describe("sigilKeyProject", () => {
    it("reads the slug a key names", () => {
      expect(sigilKeyProject("sg_alepha_s3cret")).toBe("alepha");
    });

    it("keeps a secret that contains the separator whole", () => {
      // The reason nothing here splits: secrets are base64url, and that
      // alphabet has `_` in it. A `split("_")` with a length check rejects
      // this token, and roughly two in five real ones.
      expect(sigilKeyProject("sg_alepha_ab_cd_ef")).toBe("alepha");
    });

    it("reads every slug out of a realistic batch of minted keys", () => {
      // The measured rate of a separator landing inside the secret is ~40%,
      // so a format bug here shows up as a flake rather than a failure. 200
      // keys make it a certainty instead.
      const keys = Array.from({ length: 200 }, () =>
        sigilKeyBuild(
          "my-project",
          randomBytes(32).toString("base64url").slice(0, 32),
        ),
      );

      expect(keys.every((k) => sigilKeyProject(k) === "my-project")).toBe(true);
    });

    it("accepts dashes and digits, the rest of what a slug can hold", () => {
      expect(sigilKeyProject("sg_lore-2_secret")).toBe("lore-2");
    });

    it("returns undefined for a key minted before the slug moved in", () => {
      // Not a failure: the sink resolves these by hash and always has. Only
      // the feedback link is lost.
      expect(sigilKeyProject("sg_Ab3xYz09QwErTyUi")).toBeUndefined();
    });

    it("returns undefined for an empty slug", () => {
      expect(sigilKeyProject("sg__secret")).toBeUndefined();
    });

    it("refuses a slug that could redirect the feedback link", () => {
      expect(sigilKeyProject("sg_..%2Felsewhere_secret")).toBeUndefined();
      expect(sigilKeyProject("sg_a/b_secret")).toBeUndefined();
      expect(sigilKeyProject("sg_UPPER_secret")).toBeUndefined();
    });

    it("returns undefined for anything that is not a sigil key", () => {
      expect(sigilKeyProject(undefined)).toBeUndefined();
      expect(sigilKeyProject("")).toBeUndefined();
      expect(sigilKeyProject("tk_alepha_secret")).toBeUndefined();
    });
  });

  describe("sigilKeyPrefix", () => {
    it("shows the whole slug and only a glimpse of the secret", () => {
      const prefix = sigilKeyPrefix("sg_alepha_ABCDEFGHIJKLMNOP");

      expect(prefix).toBe("sg_alepha_ABCD");
    });

    it("never reaches past the separator on a short slug", () => {
      // The bug a fixed `slice(0, 11)` had: on `sg_ab_` it filed five
      // characters of the secret in a readable column.
      const secret = "SECRETSECRETSECRET";
      const prefix = sigilKeyPrefix(sigilKeyBuild("ab", secret));

      expect(prefix).toBe("sg_ab_SECR");
      expect(prefix.length).toBe("sg_ab_".length + 4);
    });

    it("keeps the whole namespace on a long slug", () => {
      const prefix = sigilKeyPrefix(
        sigilKeyBuild("a-rather-long-project-name", "SECRETSECRET"),
      );

      expect(prefix).toBe("sg_a-rather-long-project-name_SECR");
    });

    it("falls back to the old shape for a key with no slug", () => {
      expect(sigilKeyPrefix("sg_Ab3xYz09QwErTyUi")).toBe("sg_Ab3xYz09");
    });
  });

  describe("sigilKeyBuild", () => {
    it("round-trips with the parser", () => {
      expect(sigilKeyProject(sigilKeyBuild("shop", "abc"))).toBe("shop");
    });
  });
});
