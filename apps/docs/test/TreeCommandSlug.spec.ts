import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { TreeCommand } from "../scripts/gen-tree.ts";

describe("TreeCommand slug", () => {
  const boot = () => Alepha.create().inject(TreeCommand);

  describe("slug", () => {
    it("should strip the leading order prefix", () => {
      const tree = boot();

      expect(tree.slug("1-guides")).toBe("guides");
      expect(tree.slug("12-introduction")).toBe("introduction");
    });

    it("should keep interior digits that are followed by a dash", () => {
      // The strip used to be unanchored, so `3-oauth2-setup` published at
      // `/lore/docs/guides-oauthsetup`. Nothing turned red: the page still
      // built and still rendered, only its URL was silently wrong.
      const tree = boot();

      expect(tree.slug("oauth2-setup")).toBe("oauth2-setup");
      expect(tree.slug("web3-api")).toBe("web3-api");
    });

    it("should strip only the leading prefix of a prefixed interior-digit name", () => {
      const tree = boot();

      expect(tree.slug("3-oauth2-setup")).toBe("oauth2-setup");
      expect(tree.slug("4-web3-api")).toBe("web3-api");
    });

    it("should be a no-op on an already cleaned joined path", () => {
      // getFullSlug cleans every part with cleanName before joining, so the
      // second strip inside slug() has nothing left to remove.
      const tree = boot();

      expect(tree.getFullSlug("1-guides", "3-oauth2-setup")).toBe(
        "guides-oauth2-setup",
      );
      expect(tree.getFullSlug("3-packages/alepha", "4-web3-api")).toBe(
        "packages-alepha-web3-api",
      );
    });
  });

  describe("pretty", () => {
    it("should keep interior digits in the display name", () => {
      const tree = boot();

      expect(tree.pretty("3-oauth2-setup")).toBe("Oauth2 Setup");
      expect(tree.pretty("1-guides")).toBe("Guides");
    });
  });
});
