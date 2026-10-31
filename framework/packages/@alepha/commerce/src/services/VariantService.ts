import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { orderItems } from "../entities/orderItems.ts";
import type { ProductEntity } from "../entities/products.ts";
import {
  type ProductVariantEntity,
  productVariants,
} from "../entities/productVariants.ts";
import {
  InvalidLineError,
  VariantHasOrdersError,
} from "../errors/CommerceError.ts";
import type { OptionGroup } from "../schemas/optionGroupSchema.ts";
import { PriceListService } from "./PriceListService.ts";

export interface VariantInput {
  sku: string;
  options: Record<string, string>;
  price?: number;
  image?: string;
  weightGrams?: number;
  position?: number;
  active?: boolean;
}

/**
 * The sellable combinations of a product, and the one rule about them: a line
 * on a product with variants names one, and it must be on sale.
 */
export class VariantService {
  protected readonly prices = $inject(PriceListService);
  protected readonly repo = $repository(productVariants);
  /**
   * Read-only, for {@link delete}'s guard: the same rule as a product's.
   */
  protected readonly orderItemRepo = $repository(orderItems);

  public async create(
    productId: string,
    data: VariantInput,
  ): Promise<ProductVariantEntity> {
    return this.repo.create({ ...data, productId });
  }

  public async update(
    id: string,
    data: Partial<VariantInput>,
  ): Promise<ProductVariantEntity> {
    return this.repo.updateById(id, data);
  }

  /**
   * Remove a variant for good, unless it has sold: an order line names it, and
   * switching it off hides it from buyers and keeps the history readable.
   *
   * @throws VariantHasOrdersError
   */
  public async delete(id: string): Promise<void> {
    const sold = await this.orderItemRepo.count({ variantId: { eq: id } });
    if (sold > 0) {
      throw new VariantHasOrdersError({ variantId: id, orderLines: sold });
    }
    await this.prices.removeVariant(id);
    await this.repo.deleteById(id);
  }

  public async getById(id: string): Promise<ProductVariantEntity> {
    return this.repo.getById(id);
  }

  /**
   * A product's variants, in the order a storefront shows them.
   */
  public async listOf(productId: string): Promise<ProductVariantEntity[]> {
    return this.listForProducts([productId]);
  }

  /**
   * The variants of several products in one query: what a cart, an order and a
   * page of the catalogue need.
   */
  public async listForProducts(
    productIds: string[],
  ): Promise<ProductVariantEntity[]> {
    if (productIds.length === 0) {
      return [];
    }
    return this.repo.findMany({
      where: { productId: { inArray: productIds } },
      orderBy: [
        { column: "position", direction: "asc" },
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * The variant a line sells, read from the database.
   *
   * @throws InvalidLineError see {@link pick}
   */
  public async resolve(
    product: ProductEntity,
    variantId?: string,
  ): Promise<ProductVariantEntity | undefined> {
    return this.pick(product, await this.listOf(product.id), variantId);
  }

  /**
   * The variant a line sells, among the product's own.
   *
   * A product with no variants sells as itself, and takes no variant. A product
   * with any sells only through one, on sale and its own: `variantId` comes from
   * the client.
   *
   * @throws InvalidLineError
   */
  public pick(
    product: ProductEntity,
    variants: ProductVariantEntity[],
    variantId?: string,
  ): ProductVariantEntity | undefined {
    if (variants.length === 0) {
      if (variantId) {
        throw new InvalidLineError(
          `Product ${product.id} has no variants; line named ${variantId}.`,
        );
      }
      return undefined;
    }

    if (!variantId) {
      throw new InvalidLineError(
        `Product ${product.id} is sold by variant: choose a variant.`,
      );
    }

    const variant = variants.find((it) => it.id === variantId);
    if (!variant?.active) {
      throw new InvalidLineError(
        `Variant ${variantId} of product ${product.id} is not on sale.`,
      );
    }
    return variant;
  }

  /**
   * What a buyer reads for a variant: its option values, in the order of the
   * product's groups. `56`, `Bleu / M`.
   */
  public label(product: ProductEntity, variant: ProductVariantEntity): string {
    const options = variant.options as Record<string, string>;
    const named = product.optionGroups
      .map((group) => options[group.name])
      .filter((value) => value !== undefined);
    return (named.length > 0 ? named : Object.values(options)).join(" / ");
  }

  /**
   * Write the combinations of the product's option groups that do not exist
   * yet, and answer the product's whole list. Re-run after adding a value: what
   * is already there, its stock and its price, is left alone.
   */
  public async generate(
    product: ProductEntity,
  ): Promise<ProductVariantEntity[]> {
    const existing = await this.listOf(product.id);
    const taken = new Set(existing.map((it) => this.signature(it.options)));

    const combinations = this.combine(product.optionGroups);
    for (const [position, options] of combinations.entries()) {
      if (taken.has(this.signature(options))) {
        continue;
      }
      await this.create(product.id, {
        sku: this.skuOf(product, options),
        options,
        position,
      });
    }

    return this.listOf(product.id);
  }

  protected combine(groups: OptionGroup[]): Array<Record<string, string>> {
    if (groups.length === 0) {
      return [];
    }
    return groups.reduce<Array<Record<string, string>>>(
      (combinations, group) =>
        combinations.flatMap((options) =>
          group.values.map((value) => ({ ...options, [group.name]: value })),
        ),
      [{}],
    );
  }

  /**
   * The same options written in another key order are the same combination.
   */
  protected signature(options: unknown): string {
    const entries = Object.entries(options as Record<string, string>);
    return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  protected skuOf(
    product: ProductEntity,
    options: Record<string, string>,
  ): string {
    const suffix = Object.values(options)
      .join("-")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-");
    return `${product.slug.toUpperCase()}-${suffix}`.slice(0, 64);
  }
}
