import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { subscriptions } from "../entities/subscriptions.ts";
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

/**
 * Helper to directly update subscription records for test setup.
 */
class TestRepositories {
  subscriptionRepo = $repository(subscriptions);
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
  const repos = alepha.inject(TestRepositories);
  await alepha.start();

  await config.seedPlans(testPlans);

  /**
   * Helper: create a subscription and attach a payment intent ID for billing lookup.
   */
  const createSubscriptionWithIntent = async (
    planId: string,
    intentId: string,
    options?: { skipTrial?: boolean },
  ) => {
    const orgId = randomUUID();
    const sub = await service.subscribe(orgId, planId, "monthly", options);
    await repos.subscriptionRepo.updateById(sub.id, {
      lastPaymentIntentId: intentId,
    });
    return service.getSubscription(sub.id);
  };

  return { alepha, service, config, repos, createSubscriptionWithIntent };
};

// -----------------------------------------------------------------------------------------------------------------

describe("BillingService", () => {
  // ---------------------------------------------------------------------------------------------------------------

  describe("payment captured", () => {
    it("should activate a trialing subscription after payment", async ({
      expect,
    }) => {
      const { alepha, service, createSubscriptionWithIntent } = await setup();

      const intentId = randomUUID();
      const sub = await createSubscriptionWithIntent("pro", intentId);
      expect(sub.status).toBe("trialing");

      await alepha.events.emit("payments:captured", {
        intentId,
        amount: 2900,
        currency: "usd",
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("active");
      expect(updated.lastPaymentIntentId).toBe(intentId);
    });

    it("should renew an active subscription and advance period", async ({
      expect,
    }) => {
      const { alepha, service, createSubscriptionWithIntent } = await setup();

      const intentId = randomUUID();
      const sub = await createSubscriptionWithIntent("pro", intentId, {
        skipTrial: true,
      });
      expect(sub.status).toBe("active");

      const originalPeriodEnd = sub.currentPeriodEnd;

      await alepha.events.emit("payments:captured", {
        intentId,
        amount: 2900,
        currency: "usd",
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("active");
      expect(updated.currentPeriodStart).toBe(originalPeriodEnd);
      expect(updated.currentPeriodEnd).not.toBe(originalPeriodEnd);
    });

    it("should recover from dunning", async ({ expect }) => {
      const { alepha, service, repos, createSubscriptionWithIntent } =
        await setup();

      const intentId = randomUUID();
      const sub = await createSubscriptionWithIntent("pro", intentId, {
        skipTrial: true,
      });

      await repos.subscriptionRepo.updateById(sub.id, {
        status: "past_due",
        dunningAttempt: 2,
        dunningStartedAt: new Date().toISOString(),
      });

      await alepha.events.emit("payments:captured", {
        intentId,
        amount: 2900,
        currency: "usd",
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("active");
      expect(updated.dunningAttempt).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------

  describe("payment failed", () => {
    it("should start dunning on first failure", async ({ expect }) => {
      const { alepha, service, createSubscriptionWithIntent } = await setup();

      const intentId = randomUUID();
      const sub = await createSubscriptionWithIntent("pro", intentId, {
        skipTrial: true,
      });
      expect(sub.status).toBe("active");

      await alepha.events.emit("payments:failed", {
        intentId,
        amount: 2900,
        currency: "usd",
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("past_due");
      expect(updated.dunningAttempt).toBe(1);
      expect(updated.dunningStartedAt).toBeDefined();
    });

    it("should increment dunning on subsequent failure", async ({ expect }) => {
      const { alepha, service, repos, createSubscriptionWithIntent } =
        await setup();

      const intentId = randomUUID();
      const sub = await createSubscriptionWithIntent("pro", intentId, {
        skipTrial: true,
      });

      await repos.subscriptionRepo.updateById(sub.id, {
        status: "past_due",
        dunningAttempt: 1,
        dunningStartedAt: new Date().toISOString(),
      });

      await alepha.events.emit("payments:failed", {
        intentId,
        amount: 2900,
        currency: "usd",
      });

      const updated = await service.getSubscription(sub.id);
      expect(updated.status).toBe("past_due");
      expect(updated.dunningAttempt).toBe(2);
    });
  });
});
