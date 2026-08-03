import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { shippingRates } from "../entities/shippingRates.ts";
import { shippingZones } from "../entities/shippingZones.ts";
import { ShippingService } from "../services/ShippingService.ts";

/**
 * Delivery zones and rates, for the back office.
 *
 * Lives in the shipping module rather than in `@alepha/commerce/admin`, because a
 * consumer that does not import shipping has no zones to manage and should not
 * get endpoints that answer about tables it does not have.
 */
export class AdminShippingController {
  protected readonly url = "/admin/commerce/shipping";
  protected readonly group = "admin:commerce:shipping";
  protected readonly shipping = $inject(ShippingService);

  public readonly commerceAdminShippingZones = $action({
    method: "GET",
    path: `${this.url}/zones`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List delivery zones, narrowest first",
    schema: { response: z.object({ zones: z.array(shippingZones.schema) }) },
    handler: async () => ({ zones: await this.shipping.listZones() }),
  });

  public readonly commerceAdminShippingRates = $action({
    method: "GET",
    path: `${this.url}/zones/:zoneId/rates`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List the rates of one zone",
    schema: {
      params: z.object({ zoneId: z.uuid() }),
      response: db.page(shippingRates.schema),
    },
    handler: async ({ params }) => this.shipping.pageRates(params.zoneId),
  });

  public readonly commerceAdminShippingCreateZone = $action({
    method: "POST",
    path: `${this.url}/zones`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Create a delivery zone",
    schema: {
      body: z.object({
        name: z.text({ minLength: 1, maxLength: 100 }),
        countries: z.array(z.text({ minLength: 2, maxLength: 2 })).min(1),
        priority: z.integer().min(0).max(1000).optional(),
      }),
      response: shippingZones.schema,
    },
    handler: async ({ body }) => this.shipping.createZone(body),
  });

  public readonly commerceAdminShippingCreateRate = $action({
    method: "POST",
    path: `${this.url}/zones/:zoneId/rates`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Add a rate to a zone",
    schema: {
      params: z.object({ zoneId: z.uuid() }),
      body: z.object({
        code: z.text({ minLength: 1, maxLength: 64 }),
        name: z.text({ minLength: 1, maxLength: 100 }),
        price: z.integer().min(0),
        freeAbove: z.integer().min(0).optional(),
        minDays: z.integer().min(0).max(365).optional(),
        maxDays: z.integer().min(0).max(365).optional(),
      }),
      response: shippingRates.schema,
    },
    handler: async ({ params, body }) =>
      this.shipping.createRate({ zoneId: params.zoneId, ...body }),
  });

  /**
   * Withdraw a rate. Not a delete: historical orders reference its `code`, and a
   * merchant usually wants the option back next season.
   */
  public readonly commerceAdminShippingDeactivateRate = $action({
    method: "POST",
    path: `${this.url}/rates/:id/deactivate`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Withdraw a delivery rate without deleting it",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: shippingRates.schema,
    },
    handler: async ({ params }) => this.shipping.deactivateRate(params.id),
  });
}
