import { describe, expect, it } from "vitest";

import { questBucket, questStatus, releaseBuckets } from "./releaseBuckets.ts";

const AT = "2026-11-28T00:00:00.000Z";

/**
 * A draft in a release (#Q4380, #E178 review item 11): it counts in the
 * `open` bucket, so the buckets and the ratio are what they were, and only
 * its status reads `draft`, for the chip and the questline card.
 */
describe("releaseBuckets", () => {
  describe("a draft row", () => {
    it("falls into the open bucket", () => {
      expect(questBucket({ draftAt: AT })).toBe("open");
      expect(questBucket({})).toBe("open");
    });

    it("reads draft as its status, and todo without draftAt", () => {
      expect(questStatus({ draftAt: AT })).toBe("draft");
      expect(questStatus({})).toBe("todo");
    });

    it("reads shelved when it is a shelved draft, as the quest status does", () => {
      expect(questStatus({ draftAt: AT, shelvedAt: AT })).toBe("shelved");
      expect(questBucket({ shelvedAt: AT })).toBe("shelved");
    });
  });

  it("keeps four buckets and the ratio of completed over total", () => {
    // A release of four quests in scope: one done, one running, a to-do and
    // a draft, which `progressOf` counts in `total` and nowhere else.
    const buckets = releaseBuckets({
      completed: 1,
      inProgress: 1,
      shelved: 0,
      total: 4,
    });

    expect(buckets).toEqual({
      completed: 1,
      inProgress: 1,
      open: 2,
      shelved: 0,
      total: 4,
      remaining: 3,
      percent: 25,
    });
  });
});
