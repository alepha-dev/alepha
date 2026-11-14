import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ProjectDeliveryReportService } from "../src/api/services/ProjectDeliveryReportService.ts";

/**
 * The arithmetic of DORA's keys (#Q3008): what the report reads from rows it is
 * handed, with no database between a row and the figure.
 */
class Probe extends ProjectDeliveryReportService {
  public rollbacksOf = this.rollbacks.bind(this);
  public leadTimesOf = this.leadTimes.bind(this);
}

describe("ProjectDeliveryReportService", () => {
  const probe = () => Alepha.create().inject(Probe);
  const run = (tag: string, status = "succeeded", instanceId = "i1") => ({
    instanceId,
    tag,
    status,
  });

  describe("telling a rollback", () => {
    it("counts a return to a tag the instance already ran", ({ expect }) => {
      const rows = [run("1.0"), run("1.1"), run("1.0")];

      const found = probe().rollbacksOf(rows);

      expect([...found]).toEqual([rows[2]]);
    });

    it("does not count `latest` redeployed over itself", ({ expect }) => {
      const found = probe().rollbacksOf([run("latest"), run("latest")]);

      expect(found.size).toBe(0);
    });

    it("keeps instances apart", ({ expect }) => {
      const found = probe().rollbacksOf([
        run("1.0", "succeeded", "a"),
        run("1.1", "succeeded", "b"),
        run("1.0", "succeeded", "b"),
      ]);

      expect(found.size).toBe(0);
    });

    it("ignores a run that failed", ({ expect }) => {
      const found = probe().rollbacksOf([
        run("1.0"),
        run("1.1", "failed"),
        run("1.0"),
      ]);

      expect(found.size).toBe(0);
    });
  });

  describe("lead time for changes", () => {
    const deploy = (tag: string, at: string, artifactId?: string) => ({
      tag,
      status: "succeeded",
      createdAt: at,
      finishedAt: at,
      artifactId,
    });

    it("runs to the first deploy of its release tag after it", ({ expect }) => {
      const { hours, unmatched } = probe().leadTimesOf(
        [
          deploy("1.0", "2026-06-01T00:00:00.000Z"),
          deploy("1.0", "2026-06-02T12:00:00.000Z"),
          deploy("1.0", "2026-06-03T00:00:00.000Z"),
        ],
        [],
        [
          {
            completedAt: "2026-06-02T00:00:00.000Z",
            tag: "1.0",
            commits: [],
          },
        ],
      );

      expect(hours).toEqual([12]);
      expect(unmatched).toBe(0);
    });

    it("matches a short sha against the artifact's commit", ({ expect }) => {
      const { hours } = probe().leadTimesOf(
        [deploy("main", "2026-06-02T06:00:00.000Z", "art")],
        [{ id: "art", commitSha: "abcdef0123456789" }],
        [
          {
            completedAt: "2026-06-02T00:00:00.000Z",
            commits: ["abcdef0"],
          },
        ],
      );

      expect(hours).toEqual([6]);
    });

    it("says it could not place a change, rather than guess", ({ expect }) => {
      const { hours, unmatched } = probe().leadTimesOf(
        [deploy("2.0", "2026-06-02T06:00:00.000Z")],
        [],
        [{ completedAt: "2026-06-02T00:00:00.000Z", commits: [] }],
      );

      expect(hours).toEqual([]);
      expect(unmatched).toBe(1);
    });
  });
});
