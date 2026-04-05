import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";
import { AlephaApiSubscriptions } from "../index.ts";
import type { PlanDefinition } from "../schemas/planDefinitionSchema.ts";
import { SubscriptionConfig } from "../services/SubscriptionConfig.ts";
import { SubscriptionService } from "../services/SubscriptionService.ts";

// -----------------------------------------------------------------------------------------------------------------

class TestSubscriptionConfig extends SubscriptionConfig {
  public async seedPlans(plans: PlanDefinition[]): Promise<void> {
    await this.plans.set({ plans });
  }
}

// -----------------------------------------------------------------------------------------------------------------

const testPlans: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    available: true,
    pricing: [{ interval: "monthly", amount: 0, currency: "usd" }],
    features: ["dashboard"],
    limits: { seats: 1, "api-calls": 100 },
    order: 0,
  },
  {
    id: "pro",
    name: "Pro",
    available: true,
    pricing: [
      { interval: "monthly", amount: 2900, currency: "usd" },
      { interval: "yearly", amount: 29000, currency: "usd" },
    ],
    trial: { days: 14, requirePaymentMethod: false },
    features: ["dashboard", "analytics", "export"],
    limits: { seats: 10, "api-calls": 10000 },
    order: 1,
  },
];

// -----------------------------------------------------------------------------------------------------------------

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with({ provide: SubscriptionConfig, use: TestSubscriptionConfig })
    .with(AlephaApiSubscriptions);

  const service = alepha.inject(SubscriptionService);
  const config = alepha.inject(
    TestSubscriptionConfig,
  ) as TestSubscriptionConfig;
  await alepha.start();

  await config.seedPlans(testPlans);

  return { alepha, service, config };
};

// -----------------------------------------------------------------------------------------------------------------

describe("SubscriptionService", () => {
  // ---------------------------------------------------------------------------------------------------------------

  describe("subscribe", () => {
    it("should create a trialing subscription with trial days", async ({
      expect,
    }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "pro", "monthly");

      expect(sub.status).toBe("trialing");
      expect(sub.planId).toBe("pro");
      expect(sub.interval).toBe("monthly");
      expect(sub.organizationId).toBe(orgId);
      expect(sub.trialStart).toBeDefined();
      expect(sub.trialEnd).toBeDefined();
    });

    it("should create an active subscription when skipTrial", async ({
      expect,
    }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      expect(sub.status).toBe("active");
      expect(sub.planId).toBe("pro");
      expect(sub.trialStart).toBeUndefined();
      expect(sub.trialEnd).toBeUndefined();
    });

    it("should reject when plan not found", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      await expect(
        service.subscribe(orgId, "nonexistent", "monthly"),
      ).rejects.toThrow(BadRequestError);
    });

    it("should reject duplicate subscription for same org", async ({
      expect,
    }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      await expect(service.subscribe(orgId, "free", "monthly")).rejects.toThrow(
        BadRequestError,
      );
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("cancel", () => {
    it("should cancel at period end", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      await service.cancel(sub.id, { immediate: false });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("cancelled");
      expect(updated.cancelAtPeriodEnd).toBe(true);
      expect(updated.cancelledAt).toBeDefined();
    });

    it("should cancel immediately with expired status", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      await service.cancel(sub.id, { immediate: true });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("expired");
      expect(updated.cancelAtPeriodEnd).toBe(false);
      expect(updated.cancelledAt).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("resume", () => {
    it("should resume a cancelled subscription back to active", async ({
      expect,
    }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      await service.cancel(sub.id, { immediate: false });

      const cancelled = await service.getSubscription(sub.id);
      expect(cancelled.status).toBe("cancelled");

      await service.resume(sub.id);

      const resumed = await service.getSubscription(sub.id);
      expect(resumed.status).toBe("active");
      expect(resumed.cancelAtPeriodEnd).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("changePlan", () => {
    it("should schedule plan change at period end", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "free", "monthly", {
        skipTrial: true,
      });

      await service.changePlan(sub.id, "pro", "monthly", {
        immediate: false,
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.pendingPlanId).toBe("pro");
      expect(updated.planId).toBe("free");
    });

    it("should apply immediate plan change", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const sub = await service.subscribe(orgId, "free", "monthly", {
        skipTrial: true,
      });

      await service.changePlan(sub.id, "pro", "monthly", {
        immediate: true,
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.planId).toBe("pro");
      expect(updated.pendingPlanId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("entitlements", () => {
    it("should return true for included feature", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      const canAnalytics = await service.can(orgId, "analytics");
      expect(canAnalytics).toBe(true);
    });

    it("should return false for excluded feature", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      await service.subscribe(orgId, "free", "monthly", {
        skipTrial: true,
      });

      const canAnalytics = await service.can(orgId, "analytics");
      expect(canAnalytics).toBe(false);
    });

    it("should return correct limit value", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      await service.subscribe(orgId, "pro", "monthly", {
        skipTrial: true,
      });

      const seats = await service.limit(orgId, "seats");
      expect(seats).toBe(10);

      const apiCalls = await service.limit(orgId, "api-calls");
      expect(apiCalls).toBe(10000);
    });

    it("should return 0 limit for no subscription", async ({ expect }) => {
      const { service } = await setup();
      const orgId = randomUUID();

      const seats = await service.limit(orgId, "seats");
      expect(seats).toBe(0);
    });
  });
});
