import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { promotionKindEnum, promotions } from "../entities/promotions.ts";
import { PromotionService } from "../services/PromotionService.ts";

const promotionInputSchema = z.object({
  name: z.text({ minLength: 1, maxLength: 120 }),
  code: z.text({ minLength: 1, maxLength: 64 }).optional(),
  kind: promotionKindEnum,
  value: z.integer().min(0).optional(),
  minSubtotal: z.integer().min(0).optional(),
  currency: z.text({ minLength: 3, maxLength: 3 }).optional(),
  startsAt: z.text().optional(),
  endsAt: z.text().optional(),
  usageLimit: z.integer().min(1).optional(),
  usagePerCustomer: z.integer().min(1).optional(),
  active: z.boolean().optional(),
});

/**
 * Promotion management. Reads answer how many times each has been used, which
 * is the first thing anyone asks of a code.
 */
export class AdminPromotionController {
  protected readonly url = "/admin/commerce/promotions";
  protected readonly group = "admin:commerce:promotions";
  protected readonly promotions = $inject(PromotionService);

  public readonly commerceAdminPromotionList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List promotions, newest first, with how often each was used",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
      }),
      response: db.page(promotions.schema.extend({ used: z.integer() })),
    },
    handler: async ({ query }) => {
      const page = await this.promotions.list(query);
      const content = await Promise.all(
        page.content.map(async (promotion) => ({
          ...promotion,
          used: await this.promotions.usageOf(promotion.id),
        })),
      );
      return { ...page, content };
    },
  });

  public readonly commerceAdminPromotionCreate = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Create a promotion",
    schema: { body: promotionInputSchema, response: promotions.schema },
    handler: async ({ body }) => this.promotions.create(body),
  });

  public readonly commerceAdminPromotionUpdate = $action({
    method: "PUT",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Update a promotion",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: promotionInputSchema.partial(),
      response: promotions.schema,
    },
    handler: async ({ params, body }) =>
      this.promotions.update(params.id, body),
  });

  public readonly commerceAdminPromotionDelete = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Delete a promotion nobody has used",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: async ({ params }) => {
      await this.promotions.delete(params.id);
      return { deleted: true };
    },
  });
}
