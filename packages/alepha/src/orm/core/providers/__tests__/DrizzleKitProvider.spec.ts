import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

describe("DrizzleKitProvider", () => {
  /**
   * drizzle-kit v1 moved the programmatic API from `drizzle-kit/api` to
   * per-dialect `drizzle-kit/payload/<dialect>` modules, and dropped the
   * dialect suffix from the function names. Pin both facts so a future
   * dependency bump that moves them again fails here rather than at deploy.
   */
  describe("importDrizzleKit", () => {
    it("loads the sqlite payload with unsuffixed function names", () => {
      const kit = Alepha.create().inject(DrizzleKitProvider);
      const sqlite = kit.importDrizzleKit("sqlite");

      expect(typeof sqlite.generateDrizzleJson).toBe("function");
      expect(typeof sqlite.generateMigration).toBe("function");
      expect(typeof sqlite.pushSchema).toBe("function");
    });

    it("loads the postgres payload with unsuffixed function names", () => {
      const kit = Alepha.create().inject(DrizzleKitProvider);
      const postgres = kit.importDrizzleKit("postgresql");

      expect(typeof postgres.generateDrizzleJson).toBe("function");
      expect(typeof postgres.generateMigration).toBe("function");
      expect(typeof postgres.pushSchema).toBe("function");
    });

    it("returns distinct modules per dialect", () => {
      const kit = Alepha.create().inject(DrizzleKitProvider);

      expect(kit.importDrizzleKit("sqlite")).not.toBe(
        kit.importDrizzleKit("postgresql"),
      );
    });
  });
});
