import { describe, it } from "vitest";

import { JobNameRule } from "./job-name-rule.ts";

const rule = new JobNameRule();

const job = (name: string, extra = "") =>
  `class Jobs {\n  sweep = $job({\n    name: "${name}",${extra}\n    handler: async () => {},\n  });\n}\n`;

describe("JobNameRule", () => {
  it("requires system. and a timeout from a framework package", ({
    expect,
  }) => {
    const unprefixed = rule.check(
      "packages/@alepha/lore/src/Jobs.ts",
      job("lore.sweep"),
    );
    expect(unprefixed.names).toHaveLength(1);

    const untimed = rule.check(
      "packages/@alepha/lore/src/Jobs.ts",
      job("system.lore.sweep"),
    );
    expect(untimed.names).toEqual([]);
    expect(untimed.timeouts).toHaveLength(1);
  });

  it("treats packages/@lore as application code, so its jobs keep their names", ({
    expect,
  }) => {
    expect(
      rule.check(
        "packages/@lore/work/src/api/jobs/QuestJobs.ts",
        job("quest.reminders"),
      ),
    ).toEqual({ names: [], timeouts: [] });

    expect(
      rule.check(
        "packages/@lore/deploy/src/api/jobs/BlightJobs.ts",
        job("system.blight.purge"),
      ).names,
    ).toHaveLength(1);
  });

  it("refuses system. in an app", ({ expect }) => {
    expect(
      rule.check(
        "apps/lore/src/api/jobs/QuestJobs.ts",
        job("system.quest.reminders"),
      ).names,
    ).toHaveLength(1);
    expect(
      rule.check("apps/lore/src/api/jobs/QuestJobs.ts", job("quest.reminders")),
    ).toEqual({ names: [], timeouts: [] });
  });

  it("refuses a name off the shape", ({ expect }) => {
    expect(
      rule.check("apps/lore/src/api/jobs/QuestJobs.ts", job("Quest:Reminders"))
        .names,
    ).toHaveLength(1);
  });
});
