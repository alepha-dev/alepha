import { AgentJobPace } from "@lore/core/schemas";
import { describe, it } from "vitest";

/**
 * The pace and the ceiling warning (#Q4436, epic #E181), checked against
 * four real `work-loose-quests` runs of 2026-11-25 (folio #F1556), each
 * under the 120 minute ceiling it ran with, passed as a parameter: today a
 * work run gets 12 h, and a project may set less.
 */
describe("AgentJobPace", () => {
  const START = Date.parse("2026-11-25T10:00:00.000Z");
  const at = (minute: number) =>
    new Date(START + minute * 60_000).toISOString();
  const read = (total: number, completions: number[], minute: number) =>
    AgentJobPace.of({
      startedAt: at(0),
      now: START + minute * 60_000,
      stepTimes: completions.filter((it) => it <= minute).map(at),
      total,
      ceilingSeconds: 120 * 60,
    });
  const warned = (total: number, completions: number[], end: number) =>
    Array.from({ length: end + 1 }, (_, minute) => minute).filter(
      (minute) => read(total, completions, minute)?.warning,
    );

  it("gives no range before 2 steps are done, nor once every step is", ({
    expect,
  }) => {
    expect(read(8, [24, 42], 30)).toBeUndefined();
    expect(read(2, [10, 20], 30)).toBeUndefined();
    expect(read(8, [24, 42], 42)).toBeDefined();
  });

  it("takes low from the pace up to the last step, and lets the time since it widen high", ({
    expect,
  }) => {
    // 3 of 12 done at minute 19: 9 left at 19 / 3 a quest.
    expect(read(12, [19, 19, 19], 19)).toMatchObject({
      left: 9,
      low: 57,
      high: 57,
    });
    // A stall: nothing done since, low holds and high grows.
    expect(read(12, [19, 19, 19], 40)).toMatchObject({ low: 57, high: 120 });
  });

  it("warns the 8-quest run from minute 42 and keeps the warning (it timed out with 1 left)", ({
    expect,
  }) => {
    const done = [24, 42, 56, 70, 88, 111, 112];
    const minutes = warned(8, done, 120);
    expect(minutes[0]).toBe(42);
    expect(minutes).toEqual(
      Array.from({ length: 120 - 42 + 1 }, (_, it) => 42 + it),
    );
  });

  it("warns the 21-quest run from minute 23, still at minute 60 where pace alone says it fits", ({
    expect,
  }) => {
    const done = [
      18, 23, 27, 28, 31, 31, 34, 38, 43, 46, 47, 54, 58, 63, 68, 73, 78, 91,
      93,
    ];
    const minutes = warned(21, done, 120);
    expect(minutes[0]).toBe(23);
    const sixty = read(21, done, 60);
    expect(sixty?.warning).toBe(true);
    // Pace alone: 60 minutes in and the range's low end leaves room.
    expect(60 + (sixty?.low ?? 0)).toBeLessThan(120);
  });

  it("never warns the 18-quest run, done at minute 54", ({ expect }) => {
    const done = [
      6, 6, 14, 14, 14, 16, 22, 24, 26, 28, 29, 30, 33, 35, 37, 41, 50, 54,
    ];
    expect(warned(18, done, 68)).toEqual([]);
  });

  it("warns the bursting 12-quest run from minute 34 to its last quest, never at minute 19", ({
    expect,
  }) => {
    const done = [19, 19, 19, 70, 75, 75, 75, 76, 83, 101, 107, 108];
    const minutes = warned(12, done, 109);
    expect(read(12, done, 19)?.warning).toBe(false);
    expect(minutes[0]).toBe(34);
    expect(minutes.at(-1)).toBe(107);
    // The high end grows through the 51 minutes with no completion.
    expect(read(12, done, 69)?.high).toBeGreaterThan(
      read(12, done, 20)?.high ?? 0,
    );
  });

  it("says nothing of a ceiling it is not given", ({ expect }) => {
    expect(
      AgentJobPace.of({
        startedAt: at(0),
        now: START + 60 * 60_000,
        stepTimes: [at(10), at(20)],
        total: 50,
      })?.warning,
    ).toBe(false);
  });
});
