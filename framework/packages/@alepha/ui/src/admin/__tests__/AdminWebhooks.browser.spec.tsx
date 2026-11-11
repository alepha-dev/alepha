import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import type {
  WebhookDeliveryDetailResource,
  WebhookEndpointResource,
} from "alepha/api/webhooks";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { ValidationError } from "alepha/server";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminWebhookDeliveryDialog } from "../AdminWebhookDeliveryDialog.tsx";
import { AdminWebhooks } from "../AdminWebhooks.tsx";

const endpoint = (
  over: Partial<WebhookEndpointResource>,
): WebhookEndpointResource => ({
  id: "0192e4c4-0000-7000-8000-000000000001",
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  url: "https://hooks.example.app/orders?key=x",
  events: [],
  status: "active",
  secretPrefix: "whsec_abcd",
  hasPreviousSecret: false,
  ...over,
});

const ENDPOINTS: WebhookEndpointResource[] = [
  endpoint({ description: "Fulfilment" }),
  endpoint({
    id: "0192e4c4-0000-7000-8000-000000000002",
    url: "https://acme.example.app/in",
    events: [
      "order.paid",
      "order.shipped",
      "order.refunded",
      "return.requested",
    ],
    status: "disabled",
    disabledReason: "gone",
  }),
];

const DELIVERY: WebhookDeliveryDetailResource = {
  id: "0192e4c4-0000-7000-8000-0000000000d1",
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:01.000Z",
  endpointId: ENDPOINTS[0].id,
  eventType: "order.paid",
  eventId: "0192e4c4-0000-7000-8000-0000000000e1",
  status: "failed",
  attempt: 8,
  responseStatus: 500,
  responseExcerpt: "upstream exploded",
  error: "answered 500",
  host: "hooks.example.app",
  payload: {
    id: "0192e4c4-0000-7000-8000-0000000000e1",
    type: "order.paid",
    timestamp: "2026-11-10T10:00:00.000Z",
    data: { orderId: "o-42" },
  },
};

/**
 * The webhooks admin API, as a fake server. `calls` records every write.
 */
class Links extends LinkProvider {
  public calls: Array<{ name: string; args: any }> = [];

  override client(): any {
    const page = (content: unknown[]) => ({
      content,
      page: {
        number: 0,
        size: 10,
        offset: 0,
        numberOfElements: content.length,
        totalElements: content.length,
        totalPages: 1,
        isEmpty: content.length === 0,
        isFirst: true,
        isLast: true,
      },
    });
    const record = (name: string, result: unknown) => async (args: any) => {
      this.calls.push({ name, args });
      return result;
    };
    const actions: Record<string, any> = {
      findWebhookEndpoints: async () => page(ENDPOINTS),
      getWebhookEvents: async () => [
        { name: "order.paid", description: "Paid.", schema: {} },
        { name: "order.shipped", description: "Shipped.", schema: {} },
      ],
      createWebhookEndpoint: async (args: any) => {
        this.calls.push({ name: "createWebhookEndpoint", args });
        if (args.body.url.includes("10.0.0.5")) {
          throw new ValidationError({
            part: "body",
            issues: [
              { path: "/url", message: "10.0.0.5 is a private address" },
            ],
          });
        }
        return {
          endpoint: endpoint({ url: args.body.url }),
          secret: "whsec_ONLYSHOWNONCE0123456789abcdefghijklmnopqr",
        };
      },
      updateWebhookEndpoint: record("updateWebhookEndpoint", ENDPOINTS[0]),
      getWebhookDelivery: async () => DELIVERY,
      redeliverWebhookDelivery: record("redeliverWebhookDelivery", {
        deliveryId: "0192e4c4-0000-7000-8000-0000000000d2",
      }),
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => true;
        return action;
      },
    });
  }
}

describe("AdminWebhooks", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const boot = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const mount = async () => {
    const app = await boot();
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <AdminWebhooks />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByText("hooks.example.app")).toBeTruthy(),
    );
    return app.inject(Links);
  };

  const rowOf = (text: string) =>
    screen.getByText(text).closest("tr") as HTMLTableRowElement;

  const openRowMenu = async (text: string) => {
    const trigger = rowOf(text).querySelector(
      'button[aria-label="Open row actions"]',
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    return await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBeGreaterThan(0);
      return Array.from(items) as HTMLElement[];
    });
  };

  it("lists endpoints with the host emphasised, two events then a count, and the status", async () => {
    await mount();
    const second = rowOf("acme.example.app");
    expect(second.textContent).toContain("order.paid");
    expect(second.textContent).toContain("+2");
    expect(second.textContent).toContain("Disabled");
    expect(
      second.querySelector('[title="The receiver answered 410 Gone"]'),
    ).toBeTruthy();
    const first = rowOf("hooks.example.app");
    expect(first.textContent).toContain("All events");
    expect(first.textContent).toContain("Active");
    // The path is muted, the host is not.
    expect(screen.getByText("hooks.example.app").className).toContain(
      "font-semibold",
    );
  });

  it("puts a refused destination on the URL field, and shows a new secret once", async () => {
    const links = await mount();
    fireEvent.click(screen.getByRole("button", { name: /New endpoint/ }));
    const url = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[role="dialog"] form [id$="-url"]',
      );
      expect(input).toBeTruthy();
      return input!;
    });

    fireEvent.change(url, { target: { value: "https://10.0.0.5/hooks" } });
    fireEvent.submit(url.closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("10.0.0.5 is a private address")).toBeTruthy(),
    );
    expect(screen.queryByTestId("webhook-secret")).toBeNull();

    fireEvent.change(url, {
      target: { value: "https://hooks.example.app/new" },
    });
    fireEvent.submit(url.closest("form")!);
    const secret = await waitFor(() => screen.getByTestId("webhook-secret"));
    expect(secret.textContent).toBe(
      "whsec_ONLYSHOWNONCE0123456789abcdefghijklmnopqr",
    );
    expect(screen.getByText(/will not be shown again/)).toBeTruthy();
    expect(
      links.calls.filter((it) => it.name === "createWebhookEndpoint"),
    ).toHaveLength(2);

    // Escape does not dismiss it: the button does.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByTestId("webhook-secret")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    await waitFor(() =>
      expect(screen.queryByTestId("webhook-secret")).toBeNull(),
    );
  });

  it("pauses with an Undo that resumes", async () => {
    const links = await mount();
    const items = await openRowMenu("hooks.example.app");
    const pause = items.find((it) => it.textContent?.includes("Pause"))!;
    await act(async () => {
      fireEvent.click(pause);
    });
    await waitFor(() =>
      expect(
        links.calls.find(
          (it) =>
            it.name === "updateWebhookEndpoint" &&
            it.args.body.status === "paused",
        ),
      ).toBeTruthy(),
    );
    const toast = await waitFor(() => {
      const found = [
        ...document.querySelectorAll<HTMLElement>("[data-sonner-toast]"),
      ].find((it) => it.textContent?.includes("Endpoint paused"));
      expect(found).toBeTruthy();
      return found!;
    });
    const undo = [...toast.querySelectorAll("button")].find((it) =>
      /Undo/.test(it.textContent ?? ""),
    )!;
    await act(async () => {
      fireEvent.click(undo);
    });
    await waitFor(() =>
      expect(
        links.calls.find(
          (it) =>
            it.name === "updateWebhookEndpoint" &&
            it.args.body.status === "active",
        ),
      ).toBeTruthy(),
    );
  });

  it("the delivery dialog shows the headers, the envelope, the answer and the error, and redelivers", async () => {
    const app = await boot();
    let redelivered: string | undefined;
    render(
      <AlephaContext.Provider value={app}>
        <AdminWebhookDeliveryDialog
          deliveryId={DELIVERY.id}
          onClose={() => {}}
          onRedelivered={(id) => {
            redelivered = id;
          }}
        />
      </AlephaContext.Provider>,
    );
    const body = await waitFor(() => screen.getByTestId("webhook-delivery"));
    expect(body.textContent).toContain("webhook-id");
    expect(body.textContent).toContain(DELIVERY.eventId);
    expect(body.textContent).toContain("webhook-signature");
    expect(body.textContent).toContain("o-42");
    expect(body.textContent).toContain("upstream exploded");
    expect(body.textContent).toContain("answered 500");
    expect(screen.getByTestId("webhook-delivery-status").textContent).toBe(
      "500",
    );
    fireEvent.click(screen.getByRole("button", { name: /Redeliver/ }));
    await waitFor(() =>
      expect(redelivered).toBe("0192e4c4-0000-7000-8000-0000000000d2"),
    );
  });

  it("disables Redeliver, with the reason, when the endpoint is not active", async () => {
    const app = await boot();
    render(
      <AlephaContext.Provider value={app}>
        <AdminWebhookDeliveryDialog
          deliveryId={DELIVERY.id}
          endpointActive={false}
          onClose={() => {}}
        />
      </AlephaContext.Provider>,
    );
    const button = await waitFor(() =>
      screen.getByRole("button", { name: /Redeliver/ }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("The endpoint is not active");
  });
});
