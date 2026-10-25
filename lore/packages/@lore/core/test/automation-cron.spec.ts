import { describe, it } from "vitest";

import { AutomationCron } from "../src/api/schemas/AutomationCron.ts";

describe("Automation UTC calendar", () => {
  it("rejects six fields, macros, impossible days and unaligned minutes", ({
    expect,
  }) => {
    const cron = new AutomationCron();
    for (const expression of [
      "* * * * *",
      "*/7 * * * *",
      "1 * * * *",
      "0 0 0 * * *",
      "@daily",
      "0 0 31 2 *",
      "0 0 30 2 *",
      "{{cron}}",
    ])
      expect(() => cron.validate(expression)).toThrow();
    expect(cron.validate("  */5  * * * *  ")).toBe("*/5 * * * *");
    expect(cron.validate("5-55/10 * * * MON-FRI")).toBe(
      "5-55/10 * * * MON-FRI",
    );
  });
  it("coalesces to the latest inclusive UTC tick and advances strictly beyond it", ({
    expect,
  }) => {
    const cron = new AutomationCron();
    expect(cron.latest("*/5 * * * *", "2026-10-15T10:13:59.999Z")).toBe(
      "2026-10-15T10:10:00.000Z",
    );
    expect(cron.latest("*/5 * * * *", "2026-10-15T10:10:00.000Z")).toBe(
      "2026-10-15T10:10:00.000Z",
    );
    expect(cron.next("*/5 * * * *", "2026-10-15T10:10:00.000Z")).toBe(
      "2026-10-15T10:15:00.000Z",
    );
    expect(cron.next("0 0 29 2 *", "2096-02-29T00:00:00.000Z")).toBe(
      "2104-02-29T00:00:00.000Z",
    );
    expect(cron.next("0 0 31 2 MON", "2026-02-01T00:00:00.000Z")).toBe(
      "2026-02-02T00:00:00.000Z",
    );
  });
  it("keeps UTC daily times identical across host timezones and DST boundaries", ({
    expect,
  }) => {
    const previous = process.env.TZ;
    try {
      for (const timezone of ["UTC", "America/New_York", "Pacific/Auckland"]) {
        process.env.TZ = timezone;
        const cron = new AutomationCron();
        expect(cron.next("10 0 * * *", "2026-03-08T00:10:00.000Z")).toBe(
          "2026-03-09T00:10:00.000Z",
        );
        expect(cron.latest("0 0 * * *", "2026-11-01T01:30:00.000Z")).toBe(
          "2026-11-01T00:00:00.000Z",
        );
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
