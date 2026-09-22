import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { OrderItemEntity } from "../../entities/orderItems.ts";
import type { ProductEntity } from "../../entities/products.ts";
import { InvalidLineError } from "../../errors/CommerceError.ts";
import { ResourceKindHandler } from "../../kinds/ResourceKindHandler.ts";

export interface CourtLine {
  resourceIds: string[];
  startsAt: string;
  endsAt: string;
}

/**
 * A court booking, generalised to a line that may take several courts at once
 * (a doubles tournament entry takes two): one claim per court, capacity 1.
 */
export class TestCourtKind extends ResourceKindHandler {
  public readonly kind = "test-court";
  public readonly configSchema = z.object({ courts: z.array(z.text()) });
  public readonly lineSchema = z.object({
    resourceIds: z.array(z.text()).min(1),
    startsAt: z.text(),
    endsAt: z.text(),
  });

  public readonly materialised: string[] = [];

  protected readonly dateTime = $inject(DateTimeProvider);

  public async validateLine(
    product: ProductEntity,
    line: Record<string, any>,
    quantity: number,
  ): Promise<void> {
    const { courts } = product.config as { courts: string[] };
    for (const id of (line as CourtLine).resourceIds) {
      if (!courts.includes(id)) {
        throw new InvalidLineError(`Court ${id} is not sold by this product.`);
      }
    }
    if (line.startsAt < this.dateTime.nowISOString()) {
      throw new InvalidLineError("This slot has already started.");
    }
    if (quantity !== 1) {
      throw new InvalidLineError("A court takes one booking per slot.");
    }
  }

  public resolve(item: OrderItemEntity) {
    const line = item.lineConfig as CourtLine;
    return line.resourceIds.map((resourceId) => ({
      resourceId,
      startsAt: line.startsAt,
      endsAt: line.endsAt,
      capacity: 1,
    }));
  }

  public async materialise(item: OrderItemEntity): Promise<void> {
    this.materialised.push(item.id);
  }
}
