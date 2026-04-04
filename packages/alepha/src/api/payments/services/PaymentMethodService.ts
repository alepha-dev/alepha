import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import {
  type PaymentMethodEntity,
  paymentMethods,
} from "../entities/paymentMethods.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";

export class PaymentMethodService {
  protected readonly log = $logger();
  protected readonly provider = $inject(PaymentProvider);
  protected readonly methodRepo = $repository(paymentMethods);

  public async addPaymentMethod(
    userId: string,
    organizationId: string,
    token: string,
  ): Promise<PaymentMethodEntity> {
    const result = await this.provider.createPaymentMethod(userId, token);

    const existing = await this.methodRepo.findMany({
      where: { userId: { eq: userId } },
    });

    return await this.methodRepo.create({
      userId,
      organizationId,
      type: result.type,
      brand: result.brand,
      last4: result.last4,
      expMonth: result.expMonth,
      expYear: result.expYear,
      isDefault: existing.length === 0,
      providerRef: result.providerRef,
    });
  }

  public async listPaymentMethods(
    userId: string,
  ): Promise<PaymentMethodEntity[]> {
    return await this.methodRepo.findMany({
      where: { userId: { eq: userId } },
    });
  }

  public async removePaymentMethod(
    methodId: string,
    userId: string,
  ): Promise<void> {
    const method = await this.methodRepo.getById(methodId);
    if (method.userId !== userId) {
      throw new PaymentError("Cannot remove another user's payment method");
    }

    await this.provider.deletePaymentMethod(method.providerRef);
    await this.methodRepo.deleteById(method.id);
  }

  public async setDefault(
    methodId: string,
    userId: string,
  ): Promise<PaymentMethodEntity> {
    const method = await this.methodRepo.getById(methodId);
    if (method.userId !== userId) {
      throw new PaymentError("Cannot modify another user's payment method");
    }

    const userMethods = await this.methodRepo.findMany({
      where: { userId: { eq: userId } },
    });

    for (const m of userMethods) {
      if (m.isDefault) {
        await this.methodRepo.updateById(m.id, { isDefault: false });
      }
    }

    return await this.methodRepo.updateById(method.id, { isDefault: true });
  }
}
