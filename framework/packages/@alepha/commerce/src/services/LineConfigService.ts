import { $inject, SchemaValidationError, SchemaValidator } from "alepha";

import type { ProductEntity } from "../entities/products.ts";
import { InvalidLineError } from "../errors/CommerceError.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";

/**
 * The one way a line's config is checked and a line is priced, so the cart
 * that shows a figure and the order that charges it can never disagree.
 *
 * A line config is what varies between two lines of the same product: the
 * court and the interval of "Padel, 90 minutes". It comes from the buyer, so
 * it is parsed by the kind's `lineSchema` and judged by its `validateLine`
 * both when it enters a cart and again when the order is created.
 */
export class LineConfigService {
  protected readonly kinds = $inject(ProductKindRegistry);
  protected readonly validator = $inject(SchemaValidator);

  /**
   * Parse and judge a line, returning the config to store: `undefined` for a
   * kind that takes none.
   *
   * @throws InvalidLineError, or whatever `CommerceError` the kind's
   *   `validateLine` throws.
   */
  public async accept(
    product: ProductEntity,
    lineConfig: unknown,
    quantity: number,
  ): Promise<Record<string, any> | undefined> {
    const handler = this.kinds.get(product.kind);

    if (!handler.lineSchema) {
      if (lineConfig !== undefined && lineConfig !== null) {
        throw new InvalidLineError(
          `A '${product.kind}' line takes no line config; product ${product.id} was sent one.`,
        );
      }
      return undefined;
    }

    let parsed: Record<string, any>;
    try {
      parsed = this.validator.validate(
        handler.lineSchema,
        lineConfig ?? {},
      ) as Record<string, any>;
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new InvalidLineError(
          `Invalid line config for product ${product.id}: ${error.message}`,
        );
      }
      throw error;
    }

    await handler.validateLine?.(product, parsed, quantity);
    return parsed;
  }

  /**
   * The unit price of a line, from the kind's `unitPrice` hook when it has
   * one, else the product's catalogue price. Never read from the client.
   */
  public async unitPrice(
    product: ProductEntity,
    lineConfig: Record<string, any> | undefined,
  ): Promise<number> {
    const handler = this.kinds.get(product.kind);
    return handler.unitPrice
      ? handler.unitPrice(product, lineConfig)
      : product.price;
  }
}
