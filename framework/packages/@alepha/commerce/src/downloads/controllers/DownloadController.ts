import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, $route, ForbiddenError } from "alepha/server";

import { OrderService } from "../../services/OrderService.ts";
import { DownloadService } from "../services/DownloadService.ts";

/**
 * Where a buyer collects what they bought.
 *
 * A `$route` for the file, at a root path: it is the URL an email carries, and
 * `$route` never lives under `/api`.
 */
export class DownloadController {
  protected readonly group = "commerce:downloads";
  protected readonly downloads = $inject(DownloadService);
  protected readonly orders = $inject(OrderService);

  /**
   * The link itself. Its token is the credential, so a guest needs no account;
   * what stops it is the row behind it.
   */
  public readonly commerceDownload = $route({
    method: "GET",
    path: "/commerce/downloads/:token",
    schema: {
      params: z.object({ token: z.text({ minLength: 16, maxLength: 128 }) }),
      response: z.file(),
    },
    handler: async ({ params }) => this.downloads.open(params.token),
  });

  /**
   * A signed-in customer's links, for an order page: reachable by the account
   * as well as by the email.
   */
  public readonly commerceOrderDownloads = $action({
    method: "GET",
    path: "/commerce/orders/:id/downloads",
    group: this.group,
    use: [$secure()],
    description: "List the download links of one of the customer's orders",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(
        z.object({
          name: z.text(),
          url: z.text({ maxLength: 500 }),
          expiresAt: z.text(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      const order = await this.orders.getById(params.id);
      if (order.userId !== user.id) {
        throw new ForbiddenError("This order does not belong to you.");
      }
      return this.downloads.linksFor(order.id);
    },
  });
}
