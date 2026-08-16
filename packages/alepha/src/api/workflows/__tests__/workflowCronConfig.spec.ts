import { Alepha } from "alepha";
import { CronProvider } from "alepha/scheduler";
import { describe, expect, it } from "vitest";
import { AlephaApiWorkflows, WorkflowJobs, workflowConfig } from "../index.ts";

/**
 * The cadences of the engine's three sweeps are configuration, not literals.
 *
 * What makes this worth a test is where the value ends up: `BuildCloudflareTask`
 * reads `CronProvider.getCronJobs()` to fill `triggers.crons` in wrangler.jsonc.
 * So a mut that failed to reach the provider would not fail loudly — it would
 * silently deploy a Worker on the old schedule.
 */
describe("workflow cron configuration", () => {
  const expressionOf = (alepha: Alepha, jobName: string) => {
    alepha.inject(WorkflowJobs);
    return alepha
      .inject(CronProvider)
      .getCronJobs()
      .find((job) => job.name === jobName)?.expression;
  };

  it("should default every sweep to a quarter-hour tick", () => {
    const alepha = Alepha.create().with(AlephaApiWorkflows);

    expect(expressionOf(alepha, "api:workflows:timeoutSweep")).toBe(
      "*/15 * * * *",
    );
    expect(expressionOf(alepha, "api:workflows:recoverySweep")).toBe(
      "*/15 * * * *",
    );
  });

  it("should let an app tighten the deadline sweep", () => {
    // Before `.with()`, not after: wiring a module injects its services, and a
    // `$job` reads its cron once, at field-init. A mut applied afterwards lands
    // in the store but never reaches the already-registered cron.
    const alepha = Alepha.create();
    alepha.store.mut(workflowConfig, (c) => ({
      ...c,
      timeoutCron: "* * * * *",
    }));
    alepha.with(AlephaApiWorkflows);

    expect(expressionOf(alepha, "api:workflows:timeoutSweep")).toBe(
      "* * * * *",
    );
    // Untouched keys keep their defaults.
    expect(expressionOf(alepha, "api:workflows:recoverySweep")).toBe(
      "*/15 * * * *",
    );
  });
});
