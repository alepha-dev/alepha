import { $module, Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { $audit, AlephaApiAudits, AuditService } from "../index.ts";

/**
 * Example domain-specific audit type for payments.
 */
class PaymentAudits {
  audit = $audit({
    type: "payment",
    description: "Payment processing events",
    actions: ["create", "refund", "cancel", "dispute", "capture"],
  });

  async logPaymentCreated(paymentId: string, userId: string, amount: number) {
    await this.audit.log("create", {
      userId,
      resourceType: "payment",
      resourceId: paymentId,
      description: `Payment of ${amount} created`,
      metadata: { amount, currency: "USD" },
    });
  }

  async logPaymentRefunded(paymentId: string, userId: string, reason: string) {
    await this.audit.log("refund", {
      userId,
      resourceType: "payment",
      resourceId: paymentId,
      description: `Payment refunded: ${reason}`,
      metadata: { reason },
    });
  }

  async logPaymentFailed(paymentId: string, userId: string, error: string) {
    await this.audit.logFailure("create", error, {
      userId,
      resourceType: "payment",
      resourceId: paymentId,
    });
  }
}

/**
 * Example audit type for orders.
 */
class OrderAudits {
  audit = $audit({
    type: "order",
    description: "Order management events",
    actions: ["create", "update", "cancel", "ship", "deliver", "return"],
  });

  async logOrderCreated(orderId: string, userId: string, items: number) {
    await this.audit.logSuccess("create", {
      userId,
      resourceType: "order",
      resourceId: orderId,
      description: `Order created with ${items} items`,
      metadata: { itemCount: items },
    });
  }

  async logOrderShipped(orderId: string, trackingNumber: string) {
    await this.audit.log("ship", {
      resourceType: "order",
      resourceId: orderId,
      metadata: { trackingNumber },
    });
  }
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaApiAudits);

  // Create test module with audit types
  const TestModule = $module({
    name: "test.audits",
    services: [PaymentAudits, OrderAudits],
  });

  alepha.with(TestModule);

  await alepha.start();

  return {
    alepha,
    auditService: alepha.inject(AuditService),
    paymentAudits: alepha.inject(PaymentAudits),
    orderAudits: alepha.inject(OrderAudits),
  };
};

describe("alepha/api/audits - $audit primitive", () => {
  describe("registration", () => {
    it("should register audit types with AuditService", async ({ expect }) => {
      const { auditService } = await setup();

      const types = auditService.getRegisteredTypes();

      const paymentType = types.find((t) => t.type === "payment");
      const orderType = types.find((t) => t.type === "order");

      expect(paymentType).toBeDefined();
      expect(paymentType?.description).toBe("Payment processing events");
      expect(paymentType?.actions).toContain("create");
      expect(paymentType?.actions).toContain("refund");

      expect(orderType).toBeDefined();
      expect(orderType?.description).toBe("Order management events");
      expect(orderType?.actions).toContain("ship");
    });
  });

  describe("log", () => {
    it("should log audit events through primitive", async ({ expect }) => {
      const { auditService, paymentAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await paymentAudits.logPaymentCreated("pay-001", userId, 99.99);

      const result = await auditService.find({
        type: "payment",
        resourceId: "pay-001",
      });

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const entry = result.content[0];
      expect(entry.type).toBe("payment");
      expect(entry.action).toBe("create");
      expect(entry.userId).toBe(userId);
      expect(entry.resourceType).toBe("payment");
      expect(entry.resourceId).toBe("pay-001");
      expect(entry.metadata).toEqual({ amount: 99.99, currency: "USD" });
    });

    it("should log refund events", async ({ expect }) => {
      const { auditService, paymentAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await paymentAudits.logPaymentRefunded(
        "pay-002",
        userId,
        "Customer request",
      );

      const result = await auditService.find({
        type: "payment",
        resourceId: "pay-002",
      });

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const entry = result.content[0];
      expect(entry.action).toBe("refund");
      expect(entry.metadata).toEqual({ reason: "Customer request" });
    });
  });

  describe("logSuccess", () => {
    it("should log successful events", async ({ expect }) => {
      const { auditService, orderAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await orderAudits.logOrderCreated("ord-001", userId, 3);

      const result = await auditService.find({
        type: "order",
        resourceId: "ord-001",
      });

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const entry = result.content[0];
      expect(entry.action).toBe("create");
      expect(entry.success).toBe(true);
      expect(entry.metadata).toEqual({ itemCount: 3 });
    });
  });

  describe("logFailure", () => {
    it("should log failed events with error message", async ({ expect }) => {
      const { auditService, paymentAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      await paymentAudits.logPaymentFailed("pay-003", userId, "Card declined");

      const result = await auditService.find({
        type: "payment",
        resourceId: "pay-003",
      });

      expect(result.content.length).toBeGreaterThanOrEqual(1);
      const entry = result.content[0];
      expect(entry.action).toBe("create");
      expect(entry.success).toBe(false);
      expect(entry.errorMessage).toBe("Card declined");
    });
  });

  describe("primitive properties", () => {
    it("should expose type, description, and actions", async ({ expect }) => {
      const { paymentAudits } = await setup();

      expect(paymentAudits.audit.type).toBe("payment");
      expect(paymentAudits.audit.description).toBe("Payment processing events");
      expect(paymentAudits.audit.actions).toEqual([
        "create",
        "refund",
        "cancel",
        "dispute",
        "capture",
      ]);
    });
  });

  describe("multiple audit types", () => {
    it("should handle multiple audit types independently", async ({
      expect,
    }) => {
      const { auditService, paymentAudits, orderAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      // Log events from both types
      await paymentAudits.logPaymentCreated("pay-multi", userId, 50.0);
      await orderAudits.logOrderCreated("ord-multi", userId, 2);
      await orderAudits.logOrderShipped("ord-multi", "TRACK123");

      // Check payment entries
      const payments = await auditService.find({ type: "payment" });
      expect(payments.content.some((e) => e.resourceId === "pay-multi")).toBe(
        true,
      );

      // Check order entries
      const orders = await auditService.find({ type: "order" });
      const orderEntries = orders.content.filter(
        (e) => e.resourceId === "ord-multi",
      );
      expect(orderEntries.length).toBeGreaterThanOrEqual(2);
      expect(orderEntries.some((e) => e.action === "create")).toBe(true);
      expect(orderEntries.some((e) => e.action === "ship")).toBe(true);
    });
  });

  describe("audit trail", () => {
    it("should create complete audit trail for resource", async ({
      expect,
    }) => {
      const { auditService, orderAudits } = await setup();
      const userId = "550e8400-e29b-41d4-a716-446655440000";
      const orderId = "ord-trail";

      // Simulate order lifecycle
      await orderAudits.logOrderCreated(orderId, userId, 5);
      await orderAudits.logOrderShipped(orderId, "TRACK456");
      await orderAudits.audit.log("deliver", {
        resourceType: "order",
        resourceId: orderId,
        description: "Order delivered",
      });

      // Get audit trail for this order
      const trail = await auditService.findByResource("order", orderId);

      expect(trail.content.length).toBeGreaterThanOrEqual(3);

      const actions = trail.content.map((e) => e.action);
      expect(actions).toContain("create");
      expect(actions).toContain("ship");
      expect(actions).toContain("deliver");
    });
  });
});
