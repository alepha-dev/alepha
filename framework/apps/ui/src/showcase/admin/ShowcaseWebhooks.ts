import type { Page } from "alepha";
import type {
  WebhookEndpointQuery,
  WebhookEndpointResource,
  WebhookEventResource,
} from "alepha/api/webhooks";

/**
 * Fixture webhook endpoints and events for the showcase's admin page: one
 * of each status, so every chip and row action is on screen.
 */
export class ShowcaseWebhooks {
  public paginate(query: WebhookEndpointQuery): Page<WebhookEndpointResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);
    let rows = this.rows();
    if (query.status) rows = rows.filter((r) => r.status === query.status);
    if (query.event) {
      const event = query.event;
      rows = rows.filter(
        (r) => r.events.length === 0 || r.events.includes(event),
      );
    }
    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));
    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  public events(): WebhookEventResource[] {
    return [
      {
        name: "order.paid",
        description: "An order was paid in full.",
        schema: {},
      },
      {
        name: "order.shipped",
        description: "An order left the warehouse.",
        schema: {},
      },
      {
        name: "order.refunded",
        description: "An order was refunded.",
        schema: {},
      },
    ];
  }

  protected rows(): WebhookEndpointResource[] {
    const base = {
      createdAt: "2026-11-01T09:00:00.000Z",
      updatedAt: "2026-11-10T09:00:00.000Z",
      secretPrefix: "whsec_9fQa",
      hasPreviousSecret: false,
    };
    return [
      {
        ...base,
        id: "0192e4c4-0000-7000-8000-00000000a001",
        url: "https://fulfilment.example.app/hooks/orders",
        description: "Fulfilment",
        events: ["order.paid", "order.shipped"],
        status: "active",
        lastSuccessAt: "2026-11-10T08:58:00.000Z",
      },
      {
        ...base,
        id: "0192e4c4-0000-7000-8000-00000000a002",
        url: "https://books.acme.com/webhooks",
        description: "Accounting",
        events: [],
        status: "paused",
        lastSuccessAt: "2026-11-08T17:00:00.000Z",
      },
      {
        ...base,
        id: "0192e4c4-0000-7000-8000-00000000a003",
        url: "https://legacy.example.app/in",
        events: ["order.refunded"],
        status: "disabled",
        disabledReason: "failing",
        failingSince: "2026-11-04T10:00:00.000Z",
      },
    ];
  }
}
