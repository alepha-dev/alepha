import { $store } from "alepha";
import { $repository, type SQL } from "alepha/orm";

import {
  type ProductPriceEntity,
  productPrices,
} from "../entities/productPrices.ts";
import type { ProductEntity } from "../entities/products.ts";
import type { ProductVariantEntity } from "../entities/productVariants.ts";
import { CommerceError } from "../errors/CommerceError.ts";
import { orderConfig } from "../orderConfigAtom.ts";

/**
 * The prices of a set of products in one currency.
 */
export interface PriceList {
  /**
   * What a product, or its variant, sells for. `undefined` when it is not on
   * sale in this currency.
   */
  of(
    product: ProductEntity,
    variant?: ProductVariantEntity,
  ): number | undefined;
}

/**
 * Prices per currency, and the rule that reads them.
 *
 * {@link forCurrency} is the one place a list price is decided: the cart, the
 * order and the catalogue all go through it, so a buyer is charged the figure
 * they were shown.
 */
export class PriceListService {
  protected readonly repo = $repository(productPrices);
  protected readonly config = $store(orderConfig);

  /**
   * The currency of the seller's books, and of an empty cart.
   */
  public get baseCurrency(): string {
    return this.config.baseCurrency;
  }

  /**
   * What a buyer may choose between.
   */
  public get currencies(): string[] {
    return this.config.currencies;
  }

  /**
   * Prices of these products in a currency. With none, what a cart that never
   * chose has always paid: each product's own price, in its own currency.
   */
  public async forCurrency(
    productIds: string[],
    currency?: string,
  ): Promise<PriceList> {
    const rows =
      currency && productIds.length > 0
        ? await this.repo.findMany({
            where: {
              productId: { inArray: productIds },
              currency: { eq: currency },
            },
          })
        : [];

    return {
      of: (product, variant) => {
        const own = variant?.price ?? product.price;
        if (!currency || currency === product.currency) {
          return own;
        }
        const row = (key: string) =>
          rows.find(
            (it) => it.productId === product.id && it.variantKey === key,
          )?.price;
        if (!variant) {
          return row("");
        }
        // A variant priced apart from its product has to say so here too:
        // falling back would sell the large ring at the small one's price.
        return (
          row(variant.id) ?? (variant.price === undefined ? row("") : undefined)
        );
      },
    };
  }

  /**
   * The products on sale in a currency, within a price range, as a subquery.
   * Any row counts: a product may be priced there through its variants alone.
   */
  public productsIn(
    currency: string,
    range: { minPrice?: number; maxPrice?: number } = {},
  ): SQL {
    return this.repo.subquery(
      {
        currency: { eq: currency },
        ...(range.minPrice !== undefined || range.maxPrice !== undefined
          ? {
              price: {
                ...(range.minPrice !== undefined
                  ? { gte: range.minPrice }
                  : {}),
                ...(range.maxPrice !== undefined
                  ? { lte: range.maxPrice }
                  : {}),
              },
            }
          : {}),
      },
      "productId",
    );
  }

  public async listOf(productId: string): Promise<ProductPriceEntity[]> {
    return this.repo.findMany({
      where: { productId: { eq: productId } },
      orderBy: [
        { column: "currency", direction: "asc" },
        { column: "variantKey", direction: "asc" },
      ],
    });
  }

  /**
   * Write what a product or a variant sells for in a currency.
   *
   * @throws CommerceError in a currency the shop does not sell in, or the
   *   product's own: that price lives on the product.
   */
  public async set(
    product: Pick<ProductEntity, "id" | "currency">,
    entry: { currency: string; price: number; variantId?: string },
  ): Promise<ProductPriceEntity> {
    const currency = entry.currency.toUpperCase();
    if (!this.currencies.includes(currency)) {
      throw new CommerceError(`This shop does not sell in ${currency}.`);
    }
    if (currency === product.currency) {
      throw new CommerceError(
        `${currency} is this product's own currency: its price is on the product.`,
      );
    }

    const where = this.keyOf(product.id, currency, entry.variantId);
    const existing = await this.repo.findOne({ where });
    return existing
      ? this.repo.updateById(existing.id, { price: entry.price })
      : this.repo.create({
          productId: product.id,
          variantKey: entry.variantId ?? "",
          currency,
          price: entry.price,
        });
  }

  public async remove(
    productId: string,
    entry: { currency: string; variantId?: string },
  ): Promise<void> {
    await this.repo.deleteMany(
      this.keyOf(productId, entry.currency.toUpperCase(), entry.variantId),
    );
  }

  /**
   * Forget a variant's prices along with it.
   */
  public async removeVariant(variantId: string): Promise<void> {
    await this.repo.deleteMany({ variantKey: { eq: variantId } });
  }

  protected keyOf(productId: string, currency: string, variantId?: string) {
    return {
      productId: { eq: productId },
      variantKey: { eq: variantId ?? "" },
      currency: { eq: currency },
    };
  }
}
