import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

/**
 * A `time` field, and a `date` field given a date-time with no offset, hold
 * a wall-clock value. JavaScript parses such a string in the local zone, so
 * reading it back with `toISOString()` (UTC) shifted it by the zone's offset:
 * 14:30 typed in Paris was stored as 13:30, and a local midnight as the day
 * before.
 *
 * The suite runs under `TZ=Europe/Paris`, which is what makes these fail on
 * the UTC reading; the first test pins that assumption.
 */
describe("FormModel date and time inputs", () => {
  const schema = z.object({
    at: z.time().optional(),
    day: z.date().optional(),
    when: z.datetime().optional(),
  });

  const makeForm = async (): Promise<FormModel<typeof schema>> => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    return alepha.inject(FormModel, {
      lifetime: "transient",
      args: ["f1", { id: "f1", schema, handler: () => {} }],
    }) as FormModel<typeof schema>;
  };

  it("runs in a zone that is not UTC", ({ expect }) => {
    expect(new Date(2024, 0, 15).getTimezoneOffset()).not.toBe(0);
  });

  it("stores the time that was typed", async ({ expect }) => {
    const form = await makeForm();

    form.input.at.set("14:30");
    expect(form.currentValues.at).toBe("14:30");

    form.input.at.set("00:15:59");
    expect(form.currentValues.at).toBe("00:15");
  });

  it("reads a time naming its own offset in UTC", async ({ expect }) => {
    const form = await makeForm();

    form.input.at.set("14:30Z");
    expect(form.currentValues.at).toBe("14:30");

    form.input.at.set("14:30+02:00");
    expect(form.currentValues.at).toBe("12:30");
  });

  it("stores the day of a local date-time, not the UTC day before", async ({
    expect,
  }) => {
    const form = await makeForm();

    form.input.day.set("2024-03-10T00:00");
    expect(form.currentValues.day).toBe("2024-03-10");

    form.input.day.set("2024-07-01T00:30:00");
    expect(form.currentValues.day).toBe("2024-07-01");
  });

  it("keeps a bare date, and reads a date-time naming its offset in UTC", async ({
    expect,
  }) => {
    const form = await makeForm();

    form.input.day.set("2024-03-10");
    expect(form.currentValues.day).toBe("2024-03-10");

    form.input.day.set("2024-03-10T23:30:00Z");
    expect(form.currentValues.day).toBe("2024-03-10");

    // An RFC 1123 string, or `Date.prototype.toString()`, names its zone too.
    form.input.day.set("Thu, 01 Jan 2026 23:30:00 GMT");
    expect(form.currentValues.day).toBe("2026-01-01");
    form.input.day.set(
      "Thu Jan 01 2026 23:30:00 GMT+0000 (Greenwich Mean Time)",
    );
    expect(form.currentValues.day).toBe("2026-01-01");
    form.input.day.set("1 January 2026 23:30 UTC");
    expect(form.currentValues.day).toBe("2026-01-01");

    // A date-time ending in AM or PM names none.
    form.input.day.set("1 January 2026 12:30 AM");
    expect(form.currentValues.day).toBe("2026-01-01");
  });

  it("clears on an empty or unparseable value", async ({ expect }) => {
    const form = await makeForm();

    form.input.at.set("14:30");
    form.input.at.set("");
    expect(form.currentValues.at).toBe(undefined);

    form.input.day.set("not a date");
    expect(form.currentValues.day).toBe(undefined);
  });

  it("still stores a date-time as an instant", async ({ expect }) => {
    const form = await makeForm();

    form.input.when.set("2024-03-10T14:30");
    expect(form.currentValues.when).toBe(
      new Date(2024, 2, 10, 14, 30).toISOString(),
    );
  });
});
