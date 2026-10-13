import type { Alepha } from "alepha";
import { ActorCodec } from "alepha/actor";
import { DateTimeProvider } from "alepha/datetime";
import { $rateLimit, rateLimitWindow } from "alepha/rate-limit";

export interface LimitInput {
  key: string;
  max: number;
}

export class Limits {
  fixed = $rateLimit({ name: "test:fixed", limit: 3, window: 1000 });
  dynamic = $rateLimit({
    name: "test:dynamic",
    limit: (input: LimitInput) => input.max,
    window: [1, "seconds"],
    key: (input: LimitInput) => input.key,
  });
}

export interface RateLimitFixture {
  boot(): Promise<Alepha>;
  raw(alepha: Alepha, identity: string): Promise<string | undefined>;
}

/**
 * One set of counter semantics, driven on every actor provider with travel().
 */
export class RateLimitCases {
  public static async run(
    fixture: RateLimitFixture,
    expect: (value: any) => any,
  ): Promise<void> {
    const setup = async () => {
      const alepha = await fixture.boot();
      const dateTime = alepha.inject(DateTimeProvider);
      dateTime.pause();
      const raw = (name: string, key: string) =>
        fixture.raw(
          alepha,
          alepha
            .inject(ActorCodec)
            .identity(alepha.name, rateLimitWindow.key, `${name}:${key}`),
        );
      return { limits: alepha.inject(Limits), dateTime, raw };
    };

    // The window opens on its first hit and rolls after `window`.
    {
      const { limits, dateTime } = await setup();
      const start = dateTime.nowMillis();
      await dateTime.travel(250);
      const first = await limits.fixed.consume("a");
      expect(first).toMatchObject({
        allowed: true,
        count: 1,
        limit: 3,
        remaining: 2,
        resetAt: start + 1250,
      });
      expect(first.ticket).toEqual({
        name: "test:fixed",
        key: "a",
        resetAt: start + 1250,
        limit: 3,
      });
      await limits.fixed.consume("a");
      expect(await limits.fixed.consume("a")).toMatchObject({
        allowed: true,
        count: 3,
        remaining: 0,
      });
      await dateTime.travel(400);
      expect(await limits.fixed.consume("a")).toEqual({
        allowed: false,
        reason: "limit",
        count: 4,
        limit: 3,
        remaining: 0,
        resetAt: start + 1250,
        retryAfterMs: 600,
      });
      // Keys are independent.
      expect(await limits.fixed.consume("b")).toMatchObject({ count: 1 });
      await dateTime.travel(600);
      expect(await limits.fixed.consume("a")).toMatchObject({
        allowed: true,
        count: 1,
        resetAt: start + 2250,
      });
    }

    // A refund lands in its own window only.
    {
      const { limits, dateTime } = await setup();
      const old = await limits.fixed.consume("a");
      await dateTime.travel(1000);
      expect(await limits.fixed.consume("a")).toMatchObject({ count: 1 });
      await limits.fixed.refund(old.ticket!);
      expect(await limits.fixed.consume("a")).toMatchObject({ count: 2 });
      // A refund after the window expired does not recreate the key.
      const last = await limits.fixed.consume("c");
      await dateTime.travel(1000);
      await limits.fixed.refund(last.ticket!);
      expect(await limits.fixed.consume("c")).toMatchObject({ count: 1 });
    }

    // Saturation: past the limit, refusals change nothing and write nothing.
    {
      const { limits, raw } = await setup();
      for (let i = 0; i < 3; i++) await limits.fixed.consume("s");
      expect(await limits.fixed.consume("s")).toMatchObject({ count: 4 });
      const saturated = await raw("test:fixed", "s");
      expect(JSON.parse(saturated!).state.count).toBe(4);
      for (let i = 0; i < 5; i++)
        expect(await limits.fixed.consume("s")).toMatchObject({
          allowed: false,
          count: 4,
        });
      expect(await raw("test:fixed", "s")).toBe(saturated);
    }

    // A refund after saturation clamps, so no slot is lost to the marker.
    {
      const { limits } = await setup();
      const first = await limits.fixed.consume("r");
      await limits.fixed.consume("r");
      await limits.fixed.consume("r");
      expect(await limits.fixed.consume("r")).toMatchObject({ count: 4 });
      await limits.fixed.refund(first.ticket!);
      expect(await limits.fixed.consume("r")).toMatchObject({
        allowed: true,
        count: 3,
      });
      expect(await limits.fixed.consume("r")).toMatchObject({
        allowed: false,
      });
    }

    // A limit lowered mid-window applies on the next hit, whatever the count.
    {
      const { limits } = await setup();
      for (let i = 0; i < 3; i++)
        await limits.dynamic.consume({ key: "d", max: 5 });
      expect(await limits.dynamic.consume({ key: "d", max: 2 })).toMatchObject({
        allowed: false,
        reason: "limit",
        count: 3,
        limit: 2,
      });
      expect(await limits.dynamic.consume({ key: "d", max: 5 })).toMatchObject({
        allowed: true,
        count: 4,
      });
    }
  }
}
