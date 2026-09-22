import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DatabaseProvider, sql } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AlephaCommerce } from "../index.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * Postgres by default. SQLite is the other path `ClaimLock` takes: no lock,
 * every writer queued on one connection, and the replay decides.
 */
const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerce)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerce,
        );
  const ctx = {
    alepha,
    resources: alepha.inject(ResourceService),
    dateTime: alepha.inject(DateTimeProvider),
    db: alepha.inject(DatabaseProvider),
  };
  await alepha.start();
  return ctx;
};

/**
 * An instant on a fixed Saturday, far enough ahead that nothing here is past.
 */
const at = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

const slot = (from: string, to: string) => ({
  startsAt: at(from),
  endsAt: at(to),
});

const aCourt = () => `court-${randomUUID()}`;

const outcome = (claim: Promise<unknown>) =>
  claim.then(
    () => "held" as const,
    () => "refused" as const,
  );

describe("resource reservation", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("lets exactly N of twenty racers claim a capacity-N interval", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const session = aCourt();

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () =>
          outcome(
            ctx.resources.reserve(session, {
              ...slot("18:00", "19:30"),
              capacity: 3,
              orderId: randomUUID(),
            }),
          ),
        ),
      );

      expect(outcomes.filter((it) => it === "held")).toHaveLength(3);
    });

    it("lets exactly one of racers for overlapping slots on one court stand", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const court = aCourt();
      const windows = [
        slot("18:00", "19:30"),
        slot("18:30", "20:00"),
        slot("19:00", "20:30"),
        slot("17:30", "19:00"),
      ];

      const outcomes = await Promise.all(
        windows.flatMap((window) =>
          Array.from({ length: 5 }, () =>
            outcome(
              ctx.resources.reserve(court, {
                ...window,
                capacity: 1,
                orderId: randomUUID(),
              }),
            ),
          ),
        ),
      );

      // Every window overlaps every other one at 18:30-19:00.
      expect(outcomes.filter((it) => it === "held")).toHaveLength(1);
    });

    it("counts peak concurrency, not the sum of the overlapping claims", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const room = aCourt();
      const claim = (window: { startsAt: string; endsAt: string }) =>
        outcome(
          ctx.resources.reserve(room, {
            ...window,
            capacity: 2,
            orderId: randomUUID(),
          }),
        );

      // The morning and the midday claims never meet, so the long one that
      // overlaps both only ever shares the room with one of them. A sum of
      // the overlapping claims would read two and refuse it.
      expect(await claim(slot("09:00", "10:00"))).toBe("held");
      expect(await claim(slot("10:00", "11:00"))).toBe("held");
      expect(await claim(slot("09:00", "11:00"))).toBe("held");

      // At 09:30 the room is now full.
      expect(await claim(slot("09:30", "10:30"))).toBe("refused");
    });

    it("does not count touching endpoints as an overlap", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const court = aCourt();

      for (const window of [slot("09:00", "10:00"), slot("10:00", "11:00")]) {
        await ctx.resources.reserve(court, {
          ...window,
          capacity: 1,
          orderId: randomUUID(),
        });
      }

      await expect(
        ctx.resources.reserve(court, {
          ...slot("09:59", "10:01"),
          capacity: 1,
          orderId: randomUUID(),
        }),
      ).rejects.toThrow(/no room/);
    });
  });

  describe("the interval", () => {
    it("refuses an instant with no offset, and normalises one with an offset", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();

      await expect(
        ctx.resources.reserve(court, {
          startsAt: "2030-01-05T18:00",
          endsAt: "2030-01-05T19:00",
          capacity: 1,
        }),
      ).rejects.toThrow(/with an offset/);
      await expect(
        ctx.resources.reserve(court, {
          startsAt: "next saturday",
          endsAt: at("19:00"),
          capacity: 1,
        }),
      ).rejects.toThrow(/with an offset/);

      const held = await ctx.resources.reserve(court, {
        startsAt: "2030-01-05T20:00+02:00",
        endsAt: "2030-01-05T21:00:00+02:00",
        capacity: 1,
      });
      expect([held.startsAt, held.endsAt]).toEqual([at("18:00"), at("19:00")]);

      // The same instant, written the other way, collides with it.
      await expect(
        ctx.resources.reserve(court, {
          ...slot("18:30", "19:30"),
          capacity: 1,
        }),
      ).rejects.toThrow(/no room/);
    });

    it("refuses an empty interval and a capacity below one", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");

      await expect(
        ctx.resources.reserve(aCourt(), {
          ...slot("10:00", "10:00"),
          capacity: 1,
        }),
      ).rejects.toThrow(/end after it starts/);
      await expect(
        ctx.resources.reserve(aCourt(), {
          ...slot("10:00", "11:00"),
          capacity: 0,
        }),
      ).rejects.toThrow(/capacity must be/);
    });
  });

  describe("holds", () => {
    it("stops counting an expired hold before any sweep runs", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();
      await ctx.resources.reserve(court, {
        ...slot("18:00", "19:00"),
        capacity: 1,
        orderId: randomUUID(),
      });

      await ctx.dateTime.travel(
        StockService.RESERVATION_TTL_MINUTES + 1,
        "minutes",
      );

      // Nothing has swept, and the court is free again.
      await ctx.resources.reserve(court, {
        ...slot("18:00", "19:00"),
        capacity: 1,
        orderId: randomUUID(),
      });

      expect(await ctx.resources.releaseExpiredReservations()).toBe(1);
      expect(await ctx.resources.releaseExpiredReservations()).toBe(0);
    });

    it("gives an order's holds back, and leaves a sale sold", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();
      const orderId = randomUUID();
      const sold = {
        resourceId: court,
        ...slot("09:00", "10:00"),
        capacity: 1,
      };

      await ctx.resources.commit(sold, { orderId, orderItemId: randomUUID() });
      await ctx.resources.reserve(court, {
        ...slot("10:00", "11:00"),
        capacity: 1,
        orderId,
      });

      await ctx.resources.releaseFor(orderId);
      await ctx.resources.releaseFor(orderId);

      expect(
        (await ctx.resources.claimsOf(orderId)).map((it) => it.status),
      ).toEqual(["consumed", "released"]);
    });
  });

  describe("commit", () => {
    it("consumes the line's own hold, once", async ({ expect }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();
      const line = { orderId: randomUUID(), orderItemId: randomUUID() };
      const claim = {
        resourceId: court,
        ...slot("18:00", "19:00"),
        capacity: 1,
      };

      const hold = await ctx.resources.reserve(court, { ...claim, ...line });
      const sale = await ctx.resources.commit(claim, line);
      const again = await ctx.resources.commit(claim, line);

      expect(sale.id).toBe(hold.id);
      expect(again.id).toBe(hold.id);
      expect(sale.status).toBe("consumed");
      expect(sale.expiresAt).toBeUndefined();
      expect(await ctx.resources.claimsOf(line.orderId)).toHaveLength(1);
    });

    it("claims and consumes in one step when there is no hold", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();
      const claim = {
        resourceId: court,
        ...slot("18:00", "19:00"),
        capacity: 1,
      };

      const sale = await ctx.resources.commit(claim, {
        orderId: randomUUID(),
        orderItemId: randomUUID(),
      });
      expect(sale.status).toBe("consumed");

      // And it holds the court like any sale.
      await expect(
        ctx.resources.commit(claim, {
          orderId: randomUUID(),
          orderItemId: randomUUID(),
        }),
      ).rejects.toThrow(/no room/);
    });

    it("does not trust a hold that expired while somebody else took the slot", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const court = aCourt();
      const late = { orderId: randomUUID(), orderItemId: randomUUID() };
      const claim = {
        resourceId: court,
        ...slot("18:00", "19:00"),
        capacity: 1,
      };

      await ctx.resources.reserve(court, { ...claim, ...late });
      await ctx.dateTime.travel(
        StockService.RESERVATION_TTL_MINUTES + 1,
        "minutes",
      );
      const winner = await ctx.resources.reserve(court, {
        ...claim,
        orderId: randomUUID(),
      });

      await expect(ctx.resources.commit(claim, late)).rejects.toThrow(
        /no room/,
      );
      expect(
        (await ctx.resources.claimsOf(late.orderId)).map((it) => it.status),
      ).toEqual(["released"]);
      expect(winner.status).toBe("held");
    });

    it("gives back every claim of one line, and nothing of another", async ({
      expect,
    }) => {
      const ctx = await setup("sqlite");
      const orderId = randomUUID();
      const [first, second] = [randomUUID(), randomUUID()];

      await ctx.resources.reserve(aCourt(), {
        ...slot("09:00", "10:00"),
        capacity: 1,
        orderId,
        orderItemId: first,
      });
      await ctx.resources.commit(
        { resourceId: aCourt(), ...slot("09:00", "10:00"), capacity: 1 },
        { orderId, orderItemId: first },
      );
      await ctx.resources.reserve(aCourt(), {
        ...slot("09:00", "10:00"),
        capacity: 1,
        orderId,
        orderItemId: second,
      });

      await ctx.resources.releaseItem(first);

      const claims = await ctx.resources.claimsOf(orderId);
      expect(claims.map((it) => [it.orderItemId === first, it.status])).toEqual(
        [
          [true, "released"],
          [true, "released"],
          [false, "held"],
        ],
      );
    });
  });

  /*
   * The window the racers above only hit by luck: a claim written but not
   * yet committed. Replaying by `(createdAt, id)` let a racer stamped later
   * decide before the earlier claim was visible, and both kept. Under the
   * lock the racer queues instead.
   */
  it("counts a claim whose transaction has not committed yet, on postgres", async ({
    expect,
  }) => {
    const ctx = await setup();
    const court = aCourt();
    const window = { ...slot("18:00", "19:00"), capacity: 1 };

    let commit!: () => void;
    let claimed!: () => void;
    const committing = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const first = outcome(
      ctx.db.transactional(async () => {
        try {
          await ctx.resources.reserve(court, {
            ...window,
            orderId: randomUUID(),
          });
        } finally {
          claimed();
        }
        await committing;
      }),
    );
    await ready;

    const second = outcome(
      ctx.resources.reserve(court, { ...window, orderId: randomUUID() }),
    );

    await expect
      .poll(async () => {
        const [row] = await ctx.db.execute(sql`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
            AND classid = hashtext(${ResourceService.LOCK_NAMESPACE})::oid
            AND objid = hashtext(${court})::oid`);
        return Number(row?.waiting ?? 0);
      })
      .toBe(1);
    commit();

    expect([await first, await second]).toEqual(["held", "refused"]);
  });
});
