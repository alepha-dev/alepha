import { describe, expect, it } from "vitest";

import {
  currentReleaseOf,
  orderReleases,
  releaseOfRun,
  retainedReleaseIds,
} from "./runReleases.ts";

const r = (
  id: number,
  tag: string,
  releasedAt?: string,
  defaultSince?: string,
) => ({ id, number: id, tag, title: tag, releasedAt, defaultSince });

describe("runReleases", () => {
  const releases = orderReleases([
    r(3, "0.10.0"),
    r(1, "0.8.0", "2026-01-10T00:00:00.000Z"),
    r(2, "0.9.0", "2026-02-10T00:00:00.000Z"),
  ]);

  it("orders by tag, not by text", () => {
    expect(releases.map((it) => it.tag)).toEqual(["0.8.0", "0.9.0", "0.10.0"]);
  });

  it("places a run in the first release published after it", () => {
    expect(releaseOfRun(releases, "2026-01-05T00:00:00.000Z")?.id).toBe(1);
    expect(releaseOfRun(releases, "2026-01-20T00:00:00.000Z")?.id).toBe(2);
  });

  it("places a run after the last publication in the current release", () => {
    expect(releaseOfRun(releases, "2026-03-01T00:00:00.000Z")?.id).toBe(3);
  });

  it("prefers the open default release as the current one", () => {
    const list = orderReleases([r(4, "1.0.0"), r(5, "1.1.0", undefined, "x")]);
    expect(currentReleaseOf(list)?.id).toBe(5);
  });

  it("keeps the current release and the three before it", () => {
    const list = orderReleases([
      r(1, "0.1.0", "2026-01-01T00:00:00.000Z"),
      r(2, "0.2.0", "2026-01-02T00:00:00.000Z"),
      r(3, "0.3.0", "2026-01-03T00:00:00.000Z"),
      r(4, "0.4.0", "2026-01-04T00:00:00.000Z"),
      r(5, "0.5.0", "2026-01-05T00:00:00.000Z"),
      r(6, "0.6.0"),
    ]);
    expect([...retainedReleaseIds(list)]).toEqual([3, 4, 5, 6]);
  });

  it("keeps the last four published when no release is open", () => {
    const list = orderReleases([
      r(1, "0.1.0", "2026-01-01T00:00:00.000Z"),
      r(2, "0.2.0", "2026-01-02T00:00:00.000Z"),
      r(3, "0.3.0", "2026-01-03T00:00:00.000Z"),
      r(4, "0.4.0", "2026-01-04T00:00:00.000Z"),
      r(5, "0.5.0", "2026-01-05T00:00:00.000Z"),
    ]);
    expect([...retainedReleaseIds(list)]).toEqual([3, 4, 5]);
  });
});
