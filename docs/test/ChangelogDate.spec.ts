import { afterEach, describe, expect, it } from "vitest";

import { formatDate } from "../src/components/ChangelogRelease.tsx";

describe("ChangelogRelease formatDate", () => {
  const tz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = tz;
  });

  it("should format a release date the same in every time zone", () => {
    process.env.TZ = "UTC";
    const utc = formatDate("2026-10-28");

    process.env.TZ = "America/Los_Angeles";
    const west = formatDate("2026-10-28");

    expect(utc).toBe("October 28, 2026");
    expect(west).toBe(utc);
  });
});
