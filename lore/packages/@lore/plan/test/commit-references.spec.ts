import { CommitReferenceRegistry } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LorePlanApi } from "../src/api/index.ts";
import {
  createTestProject,
  createTestQuest,
  WorkTestEntities,
} from "../src/testing/index.ts";

/**
 * A pushed commit naming `#Q<n>` lands on the quest (#Q3945), through the
 * core registry Build calls after a push.
 */
describe("PlanCommitReferences", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LorePlanApi);
    alepha.inject(WorkTestEntities);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const sha = (seed: string) => seed.repeat(40).slice(0, 40);
  const pusher = crypto.randomUUID();

  it("records each commit on the quests it names, by the pusher, once", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const other = await createTestProject(alepha);
    await createTestQuest(alepha, project, { shortId: 12 });
    await createTestQuest(alepha, project, { shortId: 13 });
    await createTestQuest(alepha, other, { shortId: 14 });
    const registry = alepha.inject(CommitReferenceRegistry);
    const input = {
      projectId: project.id,
      userId: pusher,
      repo: "acme/api",
      commits: [
        { sha: sha("a"), message: "feat: one #Q12 and #Q13\n\nbody #Q12" },
        {
          sha: sha("b"),
          message: "fix: #Q14 is another project's, #Q999 none",
        },
        {
          sha: sha("c"),
          message: "chore: x#Q12 and #Q12abc are not references",
        },
      ],
    };

    const first = await registry.record(input);
    const again = await registry.record(input);

    expect(first).toEqual({ quests: [12, 13], commits: 2 });
    expect(again).toEqual({ quests: [], commits: 0 });
    const rows = WorkTestEntities.of(alepha).quests;
    const twelve = await rows.findOne({
      where: { projectId: { eq: project.id }, shortId: { eq: 12 } },
    });
    expect(twelve?.commits).toEqual([
      expect.objectContaining({
        sha: sha("a"),
        message: "feat: one #Q12 and #Q13",
        repo: "acme/api",
        by: pusher,
      }),
    ]);
    const fourteen = await rows.findOne({
      where: { projectId: { eq: other.id }, shortId: { eq: 14 } },
    });
    expect(fourteen?.commits ?? []).toEqual([]);
  });

  it("skips a commit the quest already carries under a shorter sha", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    await createTestQuest(alepha, project, {
      shortId: 20,
      commits: [
        {
          sha: sha("d").slice(0, 9),
          at: new Date().toISOString(),
          by: crypto.randomUUID(),
        },
      ],
    });

    const result = await alepha.inject(CommitReferenceRegistry).record({
      projectId: project.id,
      userId: pusher,
      commits: [{ sha: sha("d"), message: "feat: done #Q20" }],
    });

    expect(result.commits).toBe(0);
  });

  it("answers the quests each commit landed on, by prefix either way (#Q4136)", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const other = await createTestProject(alepha);
    const at = new Date().toISOString();
    const by = crypto.randomUUID();
    await createTestQuest(alepha, project, {
      shortId: 30,
      title: "Short trail",
      commits: [{ sha: sha("e").slice(0, 7), at, by }],
    });
    await createTestQuest(alepha, project, {
      shortId: 31,
      title: "Full trail",
      commits: [
        { sha: sha("e"), at, by },
        { sha: sha("f"), at, by },
      ],
    });
    await createTestQuest(alepha, other, {
      shortId: 32,
      commits: [{ sha: sha("e"), at, by }],
    });

    const found = await alepha
      .inject(CommitReferenceRegistry)
      .questsForCommits(project.id, [sha("e"), sha("f"), sha("0")]);

    expect(found.get(sha("e"))?.map((it) => [it.number, it.title])).toEqual([
      [30, "Short trail"],
      [31, "Full trail"],
    ]);
    expect(found.get(sha("f"))?.map((it) => it.number)).toEqual([31]);
    expect(found.get(sha("0"))).toEqual([]);
  });
});
