import { describe, expect, it } from "vitest";
import { CharacterInfo } from "../src/api/services/CharacterInfo.ts";

describe("CharacterInfo", () => {
  const characterInfo = new CharacterInfo();

  describe("getLevelByXp", () => {
    it("returns 0 for negative xp", () => {
      expect(characterInfo.getLevelByXp(-1)).toBe(0);
    });

    it("returns 1 for xp below the first threshold", () => {
      expect(characterInfo.getLevelByXp(0)).toBe(1);
      expect(characterInfo.getLevelByXp(500)).toBe(1);
    });

    it("returns the max level when xp exceeds the last threshold", () => {
      // Regression: trailing return used to be `levels.length - 1`, which
      // capped at 17 instead of 18. Max level should equal levels.length.
      expect(characterInfo.getLevelByXp(Number.MAX_SAFE_INTEGER)).toBe(
        characterInfo.levels.length,
      );
    });

    it("caps at 20 (D&D-style)", () => {
      // Quest #70 extends the curve to 20 entries; assert the cap matches.
      expect(characterInfo.levels.length).toBe(20);
      expect(characterInfo.getLevelByXp(Number.MAX_SAFE_INTEGER)).toBe(20);
    });

    it("crosses the Lv.19 and Lv.20 boundaries correctly", () => {
      const lv18End = characterInfo.getGlobalMaxXpForLevel(18);
      const lv19End = characterInfo.getGlobalMaxXpForLevel(19);
      // Just inside Lv.19 (one XP past the Lv.18 boundary).
      expect(characterInfo.getLevelByXp(lv18End)).toBe(19);
      // Just inside Lv.20.
      expect(characterInfo.getLevelByXp(lv19End)).toBe(20);
    });
  });

  describe("getRank", () => {
    it("maps difficulty 1–5 to F/C/B/A/S unchanged", () => {
      // Quest #70 sanity check — extending the level curve must not touch
      // quest rank semantics.
      expect(characterInfo.getRank(1)).toBe("F");
      expect(characterInfo.getRank(2)).toBe("C");
      expect(characterInfo.getRank(3)).toBe("B");
      expect(characterInfo.getRank(4)).toBe("A");
      expect(characterInfo.getRank(5)).toBe("S");
    });
  });
});
