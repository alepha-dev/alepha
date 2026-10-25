import { $module, Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { $audit, AlephaApiAudits, AuditService } from "../index.ts";

/**
 * A type whose `update` merges and whose `delete` does not, which is the whole
 * shape of the feature: per action, never per type.
 */
class FolioAudits {
  audit = $audit({
    type: "folio",
    actions: ["create", "update", "delete"],
    coalesce: { actions: ["update"], window: "5m" },
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaDateTime);
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiAudits);
  alepha.with($module({ name: "test.coalesce", services: [FolioAudits] }));
  await alepha.start();
  return {
    alepha,
    audits: alepha.inject(AuditService),
    folio: alepha.inject(FolioAudits),
    dt: alepha.inject(DateTimeProvider),
  };
};

/**
 * Coalescing a burst of identical audit events into one row with a count.
 *
 * A project's activity feed prints one row per recorded write, so a session
 * editing one resource ten times in twenty minutes produces ten near-identical
 * rows and a reader learns nothing from the ninth. This folds them on the
 * WRITE side, which also shrinks a table that otherwise grows without bound.
 */
describe("alepha/api/audits - coalescing", () => {
  const write = async (
    folio: FolioAudits,
    over: Record<string, unknown> = {},
  ) =>
    folio.audit.logSuccess("update", {
      scopeType: "project",
      scopeId: "1",
      userId: "00000000-0000-4000-8000-000000000001",
      resourceType: "folio",
      resourceId: "104",
      description: "A folio",
      ...over,
    });

  it("folds a second identical event into the first row", async ({
    expect,
  }) => {
    const { audits, folio } = await setup();

    await write(folio);
    await write(folio);

    const page = await audits.find({ type: "folio" });

    expect(page.content).toHaveLength(1);
    expect(page.content[0].eventCount).toBe(2);
    // The span, which is the only thing that says the row is not one event.
    expect(page.content[0].updatedAt).toBeTruthy();
  });

  /**
   * ⚠️ The window is measured from `createdAt`, never from the row's last
   * event. That bounds a row's span to the window, so its position in a feed
   * sorted by `createdAt desc` is off by at most that much - and it keeps the
   * lookup a plain range the composite indexes serve as a seek.
   *
   * The visible consequence, asserted here: a burst longer than the window
   * becomes SEVERAL rows. That is wanted. One row claiming an afternoon would
   * hide a resource being picked up and put down repeatedly.
   */
  it("opens a new row once the window has passed", async ({ expect }) => {
    const { audits, folio, dt } = await setup();
    // Paused, so "inside the window" is a fact rather than a race with the
    // wall clock on a slow machine. ⚠️ `travel()` also releases every `$job`
    // cron in the container, so this asserts end state and never call counts.
    dt.pause();

    await write(folio);
    await dt.travel(4, "minute");
    await write(folio);

    let page = await audits.find({ type: "folio" });
    expect(page.content).toHaveLength(1);
    expect(page.content[0].eventCount).toBe(2);

    // Past five minutes from the FIRST event, not from the second: measuring
    // from the last event would keep this row open indefinitely under a
    // steady drip of edits.
    await dt.travel(2, "minute");
    await write(folio);

    page = await audits.find({ type: "folio" });
    expect(page.content).toHaveLength(2);
    expect(
      page.content.map((row) => row.eventCount).sort((a, b) => a - b),
    ).toEqual([1, 2]);
  });

  describe("what counts as a different event", () => {
    it("a different actor", async ({ expect }) => {
      const { audits, folio } = await setup();

      await write(folio);
      await write(folio, { userId: "00000000-0000-4000-8000-000000000002" });

      expect((await audits.find({ type: "folio" })).content).toHaveLength(2);
    });

    it("a different resource", async ({ expect }) => {
      const { audits, folio } = await setup();

      await write(folio);
      await write(folio, { resourceId: "105" });

      expect((await audits.find({ type: "folio" })).content).toHaveLength(2);
    });

    it("a different scope", async ({ expect }) => {
      const { audits, folio } = await setup();

      await write(folio);
      await write(folio, { scopeId: "2" });

      expect((await audits.find({ type: "folio" })).content).toHaveLength(2);
    });

    /**
     * The lifecycle verbs are each a distinct fact that happens once, which is
     * why the opt-in is per action. Two deletes are two deletes.
     */
    it("an action the type did not opt in", async ({ expect }) => {
      const { audits, folio } = await setup();

      await folio.audit.logSuccess("delete", {
        scopeType: "project",
        scopeId: "1",
        resourceType: "folio",
        resourceId: "104",
      });
      await folio.audit.logSuccess("delete", {
        scopeType: "project",
        scopeId: "1",
        resourceType: "folio",
        resourceId: "104",
      });

      const page = await audits.find({ type: "folio", action: "delete" });
      expect(page.content).toHaveLength(2);
      expect(page.content.every((row) => row.eventCount === 1)).toBe(true);
    });

    /**
     * Two failures are rarely the same failure, and `errorMessage` would have
     * to be merged or dropped to fold them.
     */
    it("a failure among successes", async ({ expect }) => {
      const { audits, folio } = await setup();

      await write(folio);
      await folio.audit.logFailure("update", "nope", {
        scopeType: "project",
        scopeId: "1",
        userId: "00000000-0000-4000-8000-000000000001",
        resourceType: "folio",
        resourceId: "104",
      });

      expect((await audits.find({ type: "folio" })).content).toHaveLength(2);
    });
  });

  describe("what a merged row carries", () => {
    it("keeps the FIRST description", async ({ expect }) => {
      const { audits, folio } = await setup();

      await write(folio, { description: "As it was named first" });
      await write(folio, { description: "Renamed since" });

      const [row] = (await audits.find({ type: "folio" })).content;
      // A write-time snapshot: the burst's identity was fixed when its first
      // event landed, and a rename afterwards must not rewrite history.
      expect(row.description).toBe("As it was named first");
    });

    it("unions metadata.fields and takes the last value otherwise", async ({
      expect,
    }) => {
      const { audits, folio } = await setup();

      await write(folio, { metadata: { fields: ["title"], note: "first" } });
      await write(folio, {
        metadata: { fields: ["summary", "title"], note: "second" },
      });

      const [row] = (await audits.find({ type: "folio" })).content;
      const metadata = row.metadata as Record<string, unknown>;
      // The point of a coalesced update row is that it names everything the
      // burst touched.
      expect((metadata.fields as string[]).sort()).toEqual([
        "summary",
        "title",
      ]);
      // Every other key is last-write-wins, the only rule that needs no
      // knowledge of what the key means.
      expect(metadata.note).toBe("second");
    });
  });

  describe("registration refuses a declaration it cannot honour", () => {
    it("an action outside the declared set", async ({ expect }) => {
      class Bad {
        audit = $audit({
          type: "bad",
          actions: ["create", "update"],
          // `updte` would otherwise be a rule that silently never fires,
          // which is the worst kind to debug.
          coalesce: { actions: ["updte"], window: "5m" },
        });
      }
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaDateTime);
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaApiAudits);

      // At REGISTRATION, which is when `onInit` runs - so the container never
      // reaches a state where the rule exists and does nothing.
      expect(() =>
        alepha.with($module({ name: "test.bad", services: [Bad] })),
      ).toThrow(/updte/);
    });

    it("a malformed window", async ({ expect }) => {
      class BadWindow {
        audit = $audit({
          type: "badwindow",
          actions: ["update"],
          // Days are refused: a row standing for a whole day of edits while
          // sitting at that day's start position is the failure the
          // measured-from-createdAt rule exists to avoid.
          coalesce: { actions: ["update"], window: "1d" },
        });
      }
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaDateTime);
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaApiAudits);

      expect(() =>
        alepha.with($module({ name: "test.badwindow", services: [BadWindow] })),
      ).toThrow(/malformed/);
    });
  });

  it("leaves a type that never opted in exactly as it was", async ({
    expect,
  }) => {
    class Plain {
      audit = $audit({ type: "plain", actions: ["update"] });
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaDateTime);
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaApiAudits);
    alepha.with($module({ name: "test.plain", services: [Plain] }));
    await alepha.start();

    const plain = alepha.inject(Plain);
    await plain.audit.logSuccess("update", { resourceId: "1" });
    await plain.audit.logSuccess("update", { resourceId: "1" });

    const page = await alepha.inject(AuditService).find({ type: "plain" });
    expect(page.content).toHaveLength(2);
    expect(page.content.every((row) => row.eventCount === 1)).toBe(true);
  });
});
