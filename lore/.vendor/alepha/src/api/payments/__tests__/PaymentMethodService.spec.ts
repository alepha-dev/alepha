import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { PaymentController } from "../controllers/PaymentController.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import { AlephaApiPayments } from "../index.ts";
import { PaymentMethodService } from "../services/PaymentMethodService.ts";

describe("PaymentMethodService", () => {
  const userId = randomUUID();
  const userId2 = randomUUID();

  it("allows a user without an organization to add a payment method", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const controller = alepha.inject(PaymentController);
    await alepha.start();

    const method = await controller.addPaymentMethod.run(
      { body: { token: "tok_visa" } },
      { user: { id: userId, name: "User", roles: [] } },
    );

    expect(method.last4).toBe("4242");
  });

  it("should add a payment method", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, "tok_visa");
    expect(method.type).toBe("card");
    expect(method.last4).toBe("4242");
    expect(method.isDefault).toBe(true);
  });

  it("should list payment methods for a user", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    await service.addPaymentMethod(userId, "tok_visa");
    await service.addPaymentMethod(userId, "tok_mastercard");

    const methods = await service.listPaymentMethods(userId);
    expect(methods).toHaveLength(2);
  });

  it("should remove a payment method", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, "tok_visa");
    await service.removePaymentMethod(method.id, userId);

    const methods = await service.listPaymentMethods(userId);
    expect(methods).toHaveLength(0);
  });

  it("should set a default payment method", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method1 = await service.addPaymentMethod(userId, "tok_visa");
    await service.addPaymentMethod(userId, "tok_mastercard");

    await service.setDefault(method1.id, userId);

    const methods = await service.listPaymentMethods(userId);
    const defaultMethod = methods.find((m) => m.isDefault);
    expect(defaultMethod?.id).toBe(method1.id);
  });

  it("should reject removing another user's payment method", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, "tok_visa");
    await expect(
      service.removePaymentMethod(method.id, userId2),
    ).rejects.toThrow();
  });

  it("should reject setting default for another user's payment method", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiPayments);
    const service = alepha.inject(PaymentMethodService);
    await alepha.start();

    const method = await service.addPaymentMethod(userId, "tok_visa");
    await expect(service.setDefault(method.id, userId2)).rejects.toThrow(
      PaymentError,
    );
  });
});
