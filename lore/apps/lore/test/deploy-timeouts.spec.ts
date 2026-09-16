import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { DeployJobs } from "../src/api/jobs/DeployJobs.ts";
import { DeployLimits } from "../src/api/services/DeployLimits.ts";

/**
 * Three limits bound one deploy, and they only work in one order (blight
 * #616, #Q2344):
 *
 *   deploy timer (`DeployLimits.timeoutMs`)
 *     < job timeout (`deploys.run`)
 *     < the Cloudflare Queue consumer's 15 minutes of wall clock
 *
 * A deploy timer past the consumer's limit never fires: the platform kills
 * the isolate first and nothing reports. A job with no timeout left the sweep
 * on twice the default `runTimeout`, so that death was noticed 30 to 45
 * minutes later. These pin the order, so the three cannot drift apart.
 */
describe("deploy timeouts", () => {
  const QUEUE_CONSUMER_WALL_CLOCK_MS = 15 * 60 * 1000;

  /**
   * An override saved while the ceiling was 60 minutes, which
   * `ParameterProvider` hands back as-is under the new schema.
   */
  class StaleOverrideLimits extends DeployLimits {
    public override readonly limits = {
      get: async () => ({ timeoutMs: 30 * 60 * 1000 }),
    } as unknown as DeployLimits["limits"];
  }

  it("keeps the deploy timer's ceiling under the queue consumer's wall clock", ({
    expect,
  }) => {
    expect(DeployLimits.MAX_TIMEOUT_MS).toBeLessThan(
      QUEUE_CONSUMER_WALL_CLOCK_MS,
    );
    expect(DeployLimits.DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(
      DeployLimits.MAX_TIMEOUT_MS,
    );
  });

  it("refuses a timeoutMs override past the ceiling", ({ expect }) => {
    const alepha = Alepha.create();
    const schema = alepha.inject(DeployLimits).limits.schema;

    expect(
      schema.safeParse({ timeoutMs: DeployLimits.MAX_TIMEOUT_MS }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ timeoutMs: DeployLimits.MAX_TIMEOUT_MS + 1 }).success,
    ).toBe(false);
  });

  it("clamps an override saved under the old, wider ceiling", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    expect(await alepha.inject(StaleOverrideLimits).timeoutMs()).toBe(
      DeployLimits.MAX_TIMEOUT_MS,
    );
  });

  it("declares a job timeout above the largest deploy timer and under the wall clock", ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const jobs = alepha.inject(DeployJobs);
    const timeout = jobs.runDeploy.options.timeout;

    expect(timeout).toBeDefined();
    const ms = alepha
      .inject(DateTimeProvider)
      .duration(timeout!)
      .as("milliseconds");
    expect(ms).toBeGreaterThan(DeployLimits.MAX_TIMEOUT_MS);
    expect(ms).toBeLessThan(QUEUE_CONSUMER_WALL_CLOCK_MS);
  });
});
