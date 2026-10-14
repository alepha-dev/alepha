import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type PaymentMethodEntity,
  paymentMethods,
} from "../entities/paymentMethods.ts";
import { PaymentError } from "../errors/PaymentError.ts";
import {
  type CreatePaymentMethodResult,
  PaymentProvider,
  type ProviderAccountOptions,
} from "../providers/PaymentProvider.ts";

export class PaymentMethodService {
  protected readonly log = $logger();
  protected readonly provider = $inject(PaymentProvider);
  protected readonly methodRepo = $repository(paymentMethods);

  protected async accountOptions(
    requireActive = true,
  ): Promise<ProviderAccountOptions> {
    void requireActive;
    return {};
  }

  public async addPaymentMethod(
    userId: string,
    token: string,
  ): Promise<PaymentMethodEntity> {
    const options = await this.accountOptions();
    return this.save(
      userId,
      await this.provider.createPaymentMethod(userId, token, options),
      options,
    );
  }

  public async createSetupSession(userId: string, returnUrl: string) {
    return this.provider.createSetupSession(userId, {
      ...(await this.accountOptions()),
      returnUrl,
    });
  }

  public async reconcileSession(
    userId: string,
    providerRef: string,
    account?: string,
  ): Promise<PaymentMethodEntity | null> {
    const options = await this.accountOptions(!account);
    if (account && options.stripeAccount !== account)
      throw new PaymentError("Wrong payment account");
    const result = await this.provider.retrieveSavedPaymentMethod(
      userId,
      providerRef,
      options,
    );
    return result ? this.save(userId, result, options) : null;
  }

  protected async save(
    userId: string,
    result: CreatePaymentMethodResult,
    options: ProviderAccountOptions,
  ): Promise<PaymentMethodEntity> {
    const existing = await this.methodRepo.findOne({
      where: { providerRef: { eq: result.providerRef } },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        (existing.providerAccount ?? "") !== (options.stripeAccount ?? "")
      )
        throw new PaymentError(
          "Payment method belongs to another user or account",
        );
      return existing;
    }
    const methods = (
      await this.methodRepo.findMany({ where: { userId: { eq: userId } } })
    ).filter(
      (method) =>
        (method.providerAccount ?? "") === (options.stripeAccount ?? ""),
    );
    try {
      return await this.methodRepo.create({
        userId,
        ...result,
        providerAccount: options.stripeAccount ?? "",
        isDefault: methods.length === 0,
      });
    } catch (error) {
      const concurrent = await this.methodRepo.findOne({
        where: { providerRef: { eq: result.providerRef } },
      });
      if (
        concurrent?.userId === userId &&
        (concurrent.providerAccount ?? "") === (options.stripeAccount ?? "")
      )
        return concurrent;
      throw error;
    }
  }

  public async listPaymentMethods(
    userId: string,
  ): Promise<PaymentMethodEntity[]> {
    const options = await this.accountOptions();
    const methods = await this.methodRepo.findMany({
      where: { userId: { eq: userId } },
    });
    return methods.filter(
      (method) =>
        (method.providerAccount ?? "") === (options.stripeAccount ?? ""),
    );
  }

  public async removePaymentMethod(
    methodId: string,
    userId: string,
  ): Promise<void> {
    const options = await this.accountOptions();
    const method = await this.ownedMethod(methodId, userId, options);
    await this.provider.deletePaymentMethod(method.providerRef, options);
    await this.methodRepo.deleteById(method.id);
  }

  public async setDefault(
    methodId: string,
    userId: string,
  ): Promise<PaymentMethodEntity> {
    await this.ownedMethod(methodId, userId, await this.accountOptions());
    for (const method of await this.listPaymentMethods(userId)) {
      if (method.isDefault)
        await this.methodRepo.updateById(method.id, { isDefault: false });
    }
    return this.methodRepo.updateById(methodId, { isDefault: true });
  }

  protected async ownedMethod(
    methodId: string,
    userId: string,
    options: ProviderAccountOptions,
  ) {
    const method = await this.methodRepo.getById(methodId);
    if (
      method.userId !== userId ||
      (method.providerAccount ?? "") !== (options.stripeAccount ?? "")
    )
      throw new PaymentError(
        "Payment method belongs to another user or account",
      );
    return method;
  }
}
