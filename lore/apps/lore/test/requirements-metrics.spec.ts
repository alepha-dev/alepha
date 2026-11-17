import { ProjectCapabilityController } from "@lore/core/api";
import {
  RequirementController,
  RequirementMetricService,
} from "@lore/plan-requirements/api";
import { DeployAnalytics } from "@lore/ship/api";
import { appInstances, monitors, sigils } from "@lore/ship/schemas";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Requirements verified by a metric (#E153, #Q3773): evaluated from Ship's
 * telemetry on save and by the hourly job, the result stored on the
 * requirement with its day row; no data without the Ship option or a point.
 */
class MetricProbe {
  sigils = $repository(sigils);
  copies = $repository(appInstances);
  monitors = $repository(monitors);
}

describe("metric requirements", () => {
  let ctx: RequirementsProject;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setup = async (ship: { track: boolean; uptime: boolean }) => {
    ctx = await requirementsProject({ probes: [MetricProbe] });
    const as = ctx.as(ctx.owner);
    await ctx.alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: ctx.projectId, key: "ship" },
        body: { enabled: true, options: ship },
      },
      as,
    );
    const probe = ctx.alepha.inject(MetricProbe);
    const sigil = await probe.sigils.create({
      projectId: ctx.projectId,
      name: "acme",
      tokenHash: "hash",
      tokenPrefix: "lore_sig",
    } as never);
    const copy = await probe.copies.create({
      projectId: ctx.projectId,
      app: "acme",
      env: "production",
      sigilId: sigil.id,
    } as never);
    const monitor = await probe.monitors.create({
      projectId: ctx.projectId,
      appInstanceId: copy.id,
      name: "acme api",
      kind: "http",
      target: "https://acme.example/health",
      statusSince: new Date().toISOString(),
      nextCheckAt: new Date().toISOString(),
    } as never);
    const analytics = ctx.alepha.inject(DeployAnalytics);
    const api = ctx.alepha.inject(RequirementController);
    const create = async (metric: Record<string, unknown>) =>
      (
        await api.createRequirement.fetch(
          {
            params: { projectId: ctx.projectId },
            body: {
              statement: "Fast enough",
              type: "non_functional",
              metric,
            } as never,
          },
          as,
        )
      ).data;
    const read = async (number: number) =>
      (
        await api.getRequirementByNumber.fetch(
          { params: { projectId: ctx.projectId, number } },
          as,
        )
      ).data;
    return { sigil, copy, monitor, analytics, create, read, as, api };
  };

  it("verifies a web vital at its percentile on save, for a path pattern", async ({
    expect,
  }) => {
    const t = await setup({ track: true, uptime: false });
    // LCP buckets: 1000, 1800, 2500, ...: eight fast samples, two at 2500.
    await t.analytics.vitals.recordMany([
      {
        sigilId: t.sigil.id,
        metric: "lcp",
        path: "/checkout/pay",
        bucket: 0,
        samples: 8,
      },
      {
        sigilId: t.sigil.id,
        metric: "lcp",
        path: "/checkout/pay",
        bucket: 2,
        samples: 2,
      },
      {
        sigilId: t.sigil.id,
        metric: "lcp",
        path: "/blog",
        bucket: 5,
        samples: 50,
      },
    ] as never);

    const req = await t.create({
      kind: "vital",
      vital: "lcp",
      path: "/checkout/*",
      percentile: 95,
      threshold: 2000,
    });
    expect(req.metricValue).toBe(2500);
    expect(req.status).toBe("failing");
    expect(req.metricStatusSince).toBeTruthy();
    expect(req.metricDays).toHaveLength(1);

    const p75 = (
      await t.api.updateRequirement.fetch(
        {
          params: { id: req.id },
          body: {
            metric: { ...req.metric, percentile: 75 } as never,
          },
        },
        t.as,
      )
    ).data;
    expect(p75.metricValue).toBe(1000);
    expect(p75.status).toBe("verified");
  });

  it("reads a monitor's availability and latency, and the hourly job stores them", async ({
    expect,
  }) => {
    const t = await setup({ track: false, uptime: true });
    await t.analytics.probes.recordMany([
      {
        monitorId: t.monitor.id,
        result: "up",
        prober: "local",
        count: 9,
        up: 9,
        latencyMs: 900,
      },
      {
        monitorId: t.monitor.id,
        result: "down",
        prober: "local",
        count: 1,
        up: 0,
        latencyMs: 0,
      },
    ] as never);
    const availability = await t.create({
      kind: "availability",
      threshold: 99,
    });
    expect(availability.metricValue).toBe(90);
    expect(availability.status).toBe("failing");
    const latency = await t.create({
      kind: "latency",
      monitorId: t.monitor.id,
      threshold: 300,
    });
    expect(latency.metricValue).toBe(90);
    expect(latency.status).toBe("verified");

    const service = ctx.alepha.inject(RequirementMetricService);
    expect(await service.evaluateAll()).toBe(2);
    expect((await t.read(availability.number)).metricEvaluatedAt).toBeTruthy();
  });

  it("shows no data without the Ship option, and never moves statusSince for it", async ({
    expect,
  }) => {
    const t = await setup({ track: false, uptime: false });
    const req = await t.create({ kind: "vital", vital: "inp", threshold: 200 });
    expect(req.status).toBe("no_data");
    expect(req.metricValue).toBeUndefined();
    expect(req.metricDays[0]?.status).toBe("no_data");

    const cleared = (
      await t.api.updateRequirement.fetch(
        { params: { id: req.id }, body: { metric: null } },
        t.as,
      )
    ).data;
    expect(cleared.metric).toBeUndefined();
    expect(cleared.status).toBe("not_covered");
  });
});
