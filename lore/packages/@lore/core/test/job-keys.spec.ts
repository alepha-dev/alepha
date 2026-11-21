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
});
