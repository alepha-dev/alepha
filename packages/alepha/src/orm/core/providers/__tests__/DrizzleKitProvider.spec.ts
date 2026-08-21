import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

/**
 * Exposes the protected cause-chain matcher so it can be driven without
 * standing up a database.
 */
class TestDrizzleKitProvider extends DrizzleKitProvider {
  public testErrorMentions = this.errorMentions.bind(this);
}

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

  /**
   * The lenient fallback executor skips "already exists" so a re-run against a
   * database that already has the tables is recoverable. drizzle rc.4 wraps
   * driver errors in `DrizzleQueryError`, whose own message is
   * `Failed query: <sql>` — the driver text moved into `cause`. Matching only
   * the top-level message stopped working silently at the upgrade, which made
   * `yarn v` pass on a clean tree and fail on every run after it.
   */
  describe("errorMentions", () => {
    const create = () => Alepha.create().inject(TestDrizzleKitProvider);

    it("finds the fragment nested in a DrizzleQueryError cause", () => {
      const wrapped = new Error(
        "Failed query: CREATE TABLE `alepha_sequences` (...)",
      );
      wrapped.cause = new Error("table `alepha_sequences` already exists");

      expect(create().testErrorMentions(wrapped, "already exists")).toBe(true);
    });

    it("still finds the fragment on a bare top-level error", () => {
      expect(
        create().testErrorMentions(
          new Error("table `x` already exists"),
          "already exists",
        ),
      ).toBe(true);
    });

    it("returns false when nothing in the chain matches", () => {
      const wrapped = new Error("Failed query: SELECT 1");
      wrapped.cause = new Error("syntax error near SELECT");

      expect(create().testErrorMentions(wrapped, "already exists")).toBe(false);
    });

    it("terminates on a self-referential cause chain", () => {
      const looped: any = new Error("Failed query: CREATE TABLE `x`");
      looped.cause = looped;

      expect(create().testErrorMentions(looped, "already exists")).toBe(false);
    });

    it("tolerates a non-error cause without throwing", () => {
      const wrapped: any = new Error("Failed query: CREATE TABLE `x`");
      wrapped.cause = "table `x` already exists";

      expect(create().testErrorMentions(wrapped, "already exists")).toBe(false);
    });
  });
});
