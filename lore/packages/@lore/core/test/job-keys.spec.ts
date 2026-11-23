import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { beforeEach, describe, it } from "vitest";

import {
  JobKeyService,
  LoreCoreApi,
  McpProjectScope,
} from "../src/api/index.ts";
import type { JobKey } from "../src/schemas/index.ts";

/**
 * The pins of a job key (#Q3995), checked server side: another quest,
 * feedback item or epic, another project. No tool allowlist since #Q4222:
 * the owner's rank bounds the rest, and the key reaches Lore's MCP only.
 */
const key = (overrides: Partial<JobKey> = {}): JobKey => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  apiKeyId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  projectId: 7,
  userId: crypto.randomUUID(),
  questNumber: 12,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});

describe("JobKeyService", () => {
  let alepha: Alepha;
  let keys: JobKeyService;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreCoreApi);
    await alepha.start();
    keys = alepha.inject(JobKeyService);
  });

  it("opens any tool within its pins: there is no allowlist (#Q4222)", ({
    expect,
  }) => {
    expect(() =>
      keys.check(key(), "quest_complete", { shortId: 12 }),
    ).not.toThrow();
    expect(() => keys.check(key(), "quest_complete", { shortId: 13 })).toThrow(
      "reaches quest 12 only",
    );
  });

  it("holds a pinned quest and feedback item to their numbers", ({
    expect,
  }) => {
    expect(() => keys.check(key(), "quest_get", { shortId: 13 })).toThrow(
      "reaches quest 12 only",
    );
    expect(() => keys.check(key(), "quest_get", { id: 999 })).toThrow(
      "reaches quest 12 only",
    );
    expect(() => keys.check(key(), "quest_list", {})).not.toThrow();
    const feedback = key({ questNumber: undefined, feedbackNumber: 4 });
    expect(() => keys.check(feedback, "feedback_get", { shortId: 5 })).toThrow(
      "reaches feedback 4 only",
    );
    expect(() =>
      keys.check(feedback, "feedback_get", { shortId: 4 }),
    ).not.toThrow();
  });

  it("holds a global triage's key to its set of feedback items, quest links included (#Q4183)", ({
    expect,
  }) => {
    const triage = key({
      questNumber: undefined,
      feedbackNumbers: [4, 9],
    });
    expect(() =>
      keys.check(triage, "feedback_get", { shortId: 9 }),
    ).not.toThrow();
    expect(() => keys.check(triage, "feedback_accept", { shortId: 5 })).toThrow(
      "reaches feedback 4, 9 only",
    );
    expect(() =>
      keys.check(triage, "quest_create", { feedback_shortId: 4 }),
    ).not.toThrow();
    expect(() =>
      keys.check(triage, "quest_create", { feedback_shortId: 5 }),
    ).toThrow("reaches feedback 4, 9 only");
    expect(() => keys.check(triage, "quest_create", {})).not.toThrow();
    // A one-item key links only its own item too.
    const one = key({
      questNumber: undefined,
      feedbackNumber: 4,
    });
    expect(() =>
      keys.check(one, "quest_create", { feedback_shortId: 5 }),
    ).toThrow("reaches feedback 4 only");
  });

  it("refuses a revoked key", ({ expect }) => {
    expect(() =>
      keys.check(key({ revokedAt: new Date().toISOString() }), "quest_get", {
        shortId: 12,
      }),
    ).toThrow("revoked");
  });

  it("pins the MCP run to the key's project, so another project is refused", ({
    expect,
  }) => {
    const scope = alepha.inject(McpProjectScope);
    alepha.context.run(
      () => {
        scope.pin(7);
        expect(() => scope.resolved(8)).toThrow(
          "This run belongs to project 7",
        );
        expect(() => scope.resolved(7)).not.toThrow();
      },
      { [McpProjectScope.KEY]: {} },
    );
  });
  it("holds an epic pin to its epic, its creates under it, and its quests inside it (#Q4214)", ({
    expect,
  }) => {
    const epic = key({
      questNumber: undefined,
      epicNumber: 3,
    });
    expect(() => keys.check(epic, "epic_get", { number: 3 })).not.toThrow();
    expect(() => keys.check(epic, "epic_update", { number: 4 })).toThrow(
      "epic 3 only",
    );
    expect(() => keys.check(epic, "epic_review_create", {})).toThrow(
      "epic 3 only",
    );
    expect(() =>
      keys.check(epic, "quest_create", { epic_number: 3, title: "x" }),
    ).not.toThrow();
    expect(() => keys.check(epic, "quest_create", { title: "x" })).toThrow(
      "pass epic_number 3",
    );
    expect(() => keys.check(epic, "folio_create", { epic_number: 4 })).toThrow(
      "pass epic_number 3",
    );
    expect(() =>
      keys.check(epic, "quest_update", { shortId: 10, epic_number: 0 }),
    ).toThrow("keeps quests in epic 3");
  });

  it("refuses an epic pin's quest tools when no membership lookup is registered", async ({
    expect,
  }) => {
    const epic = key({ questNumber: undefined, epicNumber: 3 });
    await expect(
      keys.checkEpicQuest(epic, "quest_get", { shortId: 10 }),
    ).rejects.toThrow("the quests of epic 3 only");
    await expect(
      keys.checkEpicQuest(epic, "quest_list", {}),
    ).resolves.toBeUndefined();
  });
});
