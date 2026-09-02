import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

/**
 * Exposes the protected cause-chain matcher so it can be driven without
 * standing up a database.
 */
class TestDrizzleKitProvider extends DrizzleKitProvider {
  public testErrorMentions = this.errorMentions.bind(this);
  public testReportFallbackOutcome = this.reportFallbackOutcome.bind(this);
  public warnings: string[] = [];
  protected override readonly log = {
    warn: (message: string) => {
      this.warnings.push(message);
    },
    info: () => {},
    debug: () => {},
    trace: () => {},
    error: () => {},
  } as any;
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

  /**
   * When `pushSchema` throws (drizzle-kit rc.4 does, on any column change,
   * for want of a `HintsHandler`), the fallback diffs against an empty
   * snapshot and can only CREATE. It used to warn only when it had applied
   * nothing at all, so one new table since the last run silenced it while
   * every other table kept its stale columns and the boot log said "OK".
   */
  describe("reportFallbackOutcome", () => {
    const create = () => Alepha.create().inject(TestDrizzleKitProvider);

    it("warns when the fallback left existing tables alone, even after creating one", () => {
      const kit = create();

      kit.testReportFallbackOutcome(
        "sqlite",
        1,
        3,
        new Error("no HintsHandler"),
      );

      expect(kit.warnings).toHaveLength(1);
      expect(kit.warnings[0]).toContain("could NOT be fully synchronized");
      expect(kit.warnings[0]).toContain("no HintsHandler");
      expect(kit.warnings[0]).toContain("1 created, 3 already existed");
    });

    it("warns when nothing at all could be applied", () => {
      const kit = create();

      kit.testReportFallbackOutcome("sqlite", 0, 12, new Error("push failed"));

      expect(kit.warnings).toHaveLength(1);
    });

    it("stays quiet when every statement landed", () => {
      const kit = create();

      kit.testReportFallbackOutcome("sqlite", 4, 0, new Error("push failed"));

      expect(kit.warnings).toHaveLength(0);
    });
  });
});
