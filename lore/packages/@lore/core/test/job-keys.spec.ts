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
 * The pins of a job key (#Q3995), checked server side: a tool off the
 * allowlist, another quest or feedback item, another project, a ref outside
 * the prefix. The git half runs against a real `git` in Build's
 * `git-http.spec.ts`.
 */
const key = (overrides: Partial<JobKey> = {}): JobKey => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  apiKeyId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  projectId: 7,
  userId: crypto.randomUUID(),
  tools: ["quest_get", "quest_comment_add", "quest_list", "feedback_get"],
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

  it("refuses a tool off the allowlist, whatever the call asks", ({
    expect,
  }) => {
    expect(() => keys.check(key(), "quest_complete", { shortId: 12 })).toThrow(
      "does not reach the tool quest_complete",
    );
    expect(() => keys.check(key(), "quest_get", { shortId: 12 })).not.toThrow();
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
      tools: ["feedback_get", "feedback_accept", "quest_create"],
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
      tools: ["quest_create"],
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

  it("writes only below its ref prefix", ({ expect }) => {
    const writer = key({ writeRefPrefix: "lore/q12" });
    expect(keys.mayWriteRef(writer, "refs/heads/lore/q12")).toBe(true);
    expect(keys.mayWriteRef(writer, "refs/heads/lore/q12/retry")).toBe(true);
    expect(keys.mayWriteRef(writer, "refs/heads/lore/q123")).toBe(false);
    expect(keys.mayWriteRef(writer, "refs/heads/main")).toBe(false);
    expect(keys.mayWriteRef(writer, "refs/tags/lore/q12")).toBe(false);
    expect(keys.mayWriteRef(key(), "refs/heads/lore/q12")).toBe(false);
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
      tools: [
        "epic_get",
        "epic_update",
        "epic_review_create",
        "quest_create",
        "quest_update",
        "folio_create",
      ],
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
