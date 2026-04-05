import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { PaymentError } from "../errors/PaymentError.ts";
import { AlephaPayments } from "../index.ts";
import { PaymentMethodService } from "../services/PaymentMethodService.ts";

describe("PaymentMethodService", () => {
  const userId = randomUUID();
  const userId2 = randomUUID();
  const orgId = randomUUID();
  it("should add a payment method", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, orgId, "tok_visa");
    expect(method.type).toBe("card");
    expect(method.last4).toBe("4242");
    expect(method.isDefault).toBe(true);
  });

  it("should list payment methods for a user", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    await service.addPaymentMethod(userId, orgId, "tok_visa");
    await service.addPaymentMethod(userId, orgId, "tok_mastercard");

    const methods = await service.listPaymentMethods(userId);
    expect(methods).toHaveLength(2);
  });

  it("should remove a payment method", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, orgId, "tok_visa");
    await service.removePaymentMethod(method.id, userId);

    const methods = await service.listPaymentMethods(userId);
    expect(methods).toHaveLength(0);
  });

  it("should set a default payment method", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method1 = await service.addPaymentMethod(userId, orgId, "tok_visa");
    const method2 = await service.addPaymentMethod(
      userId,
      orgId,
      "tok_mastercard",
    );

    await service.setDefault(method1.id, userId);

    const methods = await service.listPaymentMethods(userId);
    const defaultMethod = methods.find((m) => m.isDefault);
    expect(defaultMethod?.id).toBe(method1.id);
  });

  it("should reject removing another user's payment method", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, orgId, "tok_visa");
    await expect(
      service.removePaymentMethod(method.id, userId2),
    ).rejects.toThrowError();
  });

  it("should reject setting default for another user's payment method", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, orgId, "tok_visa");
    await expect(service.setDefault(method.id, userId2)).rejects.toThrowError(
      PaymentError,
    );
  });
});
