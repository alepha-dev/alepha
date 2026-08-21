import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { InvalidAddressError } from "../../errors/CommerceError.ts";
import {
  type AddressEntity,
  type AddressInput,
  addresses,
} from "../entities/addresses.ts";
import { AddressRulesProvider } from "../providers/AddressRulesProvider.ts";

/**
 * Validates and stores postal addresses.
 *
 * Validation happens here rather than in the zod schema because the rule depends
 * on another field: a postcode is only valid *for a country*. A schema can say
 * "2 to 16 characters"; only this service can say "FR wants five digits".
 */
export class AddressService {
  protected readonly repo = $repository(addresses);
  protected readonly rules = $inject(AddressRulesProvider);

  /**
   * Check an address and return it normalised, or throw naming the field at
   * fault. Does not write anything — {@link create} does that.
   *
   * @throws InvalidAddressError
   */
  public validate(input: AddressInput): AddressInput {
    const country = input.country.trim().toUpperCase();
    const rule = this.rules.rules()[country];

    if (!rule) {
      throw new InvalidAddressError(
        "country",
        `'${country}' is not a country this shop delivers to. Supported: ${this.rules
          .countries()
          .join(", ")}.`,
      );
    }

    const postalCode = this.rules.normalisePostalCode(input.postalCode);
    if (!rule.postalCode.test(postalCode)) {
      throw new InvalidAddressError(
        "postalCode",
        `'${input.postalCode}' is not a valid postal code for ${rule.name}. Expected something like '${rule.example}'.`,
      );
    }

    if (rule.requiresRegion && !input.region?.trim()) {
      throw new InvalidAddressError(
        "region",
        `${rule.name} requires a region.`,
      );
    }

    return { ...input, country, postalCode };
  }

  /**
   * Validate then store. `userId` absent means a guest address, which is kept so
   * the order can be shipped but belongs to no account.
   */
  public async create(
    input: AddressInput,
    options: { userId?: string; isDefault?: boolean } = {},
  ): Promise<AddressEntity> {
    const clean = this.validate(input);

    if (options.isDefault && options.userId) {
      await this.clearDefault(options.userId);
    }

    return this.repo.create({
      ...clean,
      userId: options.userId,
      isDefault: options.isDefault ?? false,
    });
  }

  /**
   * A signed-in customer's address book, default first.
   */
  public async listOf(userId: string): Promise<AddressEntity[]> {
    return this.repo.findMany({
      where: { userId: { eq: userId } },
      orderBy: [{ column: "isDefault", direction: "desc" }],
    });
  }

  public async getById(id: string): Promise<AddressEntity> {
    return this.repo.getById(id);
  }

  public async setDefault(
    userId: string,
    addressId: string,
  ): Promise<AddressEntity> {
    await this.clearDefault(userId);
    return this.repo.updateById(addressId, { isDefault: true });
  }

  protected async clearDefault(userId: string): Promise<void> {
    const current = await this.repo.findMany({
      where: { userId: { eq: userId }, isDefault: { eq: true } },
    });
    for (const address of current) {
      await this.repo.updateById(address.id, { isDefault: false });
    }
  }
}
