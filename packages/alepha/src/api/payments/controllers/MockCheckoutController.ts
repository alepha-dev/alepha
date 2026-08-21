import { $atom, $inject, $store, Alepha, type Infer, z } from "alepha";
import { $route, type ServerReply } from "alepha/server";

import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
import { PaymentService } from "../services/PaymentService.ts";

/**
 * Options for the mock checkout endpoints.
 */
export const mockCheckoutOptions = $atom({
  name: "alepha.api.payments.mock-checkout.options",
  schema: z.object({
    allowInProduction: z
      .boolean()
      .describe(
        "Explicitly allow the mock checkout in production. The confirm " +
          "endpoint is an unauthenticated 'mark as paid' — an app shipped " +
          "without a real PSP must not silently expose it.",
      )
      .default(false),
  }),
  default: { allowInProduction: false },
  serverOnly: true,
});

export type MockCheckoutOptions = Infer<typeof mockCheckoutOptions.schema>;

declare module "alepha" {
  interface State {
    [mockCheckoutOptions.key]: MockCheckoutOptions;
  }
}

const FORBIDDEN_HTML =
  "<!doctype html><meta charset=utf-8><title>Mock checkout</title>" +
  "<p>Mock checkout is only available with the in-memory payment provider.</p>";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );

const formatAmount = (cents: number, currency: string) => {
  const value = (cents / 100).toFixed(2);
  return `${value} ${currency.toUpperCase()}`;
};

const renderPage = (opts: {
  intentId: string;
  amount: string;
  returnUrl: string;
}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Checkout</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      display:flex; min-height:100vh; align-items:center; justify-content:center;
      margin:0; padding:1rem; background:#f8fafc; color:#0b1120;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .card {
      background:#fff; border:1px solid #e2e8f0; border-radius:16px;
      box-shadow:0 12px 40px rgba(11,17,32,.08); max-width:400px; width:100%;
      overflow:hidden;
    }
    .head { padding:1.5rem 1.75rem 1.25rem; border-bottom:1px solid #e2e8f0; }
    .badge {
      display:inline-flex; align-items:center; gap:.35rem;
      background:#fff7ed; color:#c2410c; border:1px solid #fed7aa;
      font-size:.7rem; font-weight:600; letter-spacing:.04em;
      padding:3px 10px; border-radius:999px; text-transform:uppercase;
    }
    .label { margin:.9rem 0 0; font-size:.8rem; color:#64748b; }
    .amount { font-size:2.25rem; font-weight:800; letter-spacing:-.02em; margin:.15rem 0 0; }
    .body { padding:1.5rem 1.75rem 1.75rem; }
    .field { margin-bottom: .9rem; }
    .field label { display:block; font-size:.75rem; font-weight:600; color:#334155; margin-bottom:.3rem; }
    .field input {
      width:100%; padding:.65rem .8rem; border:1px solid #e2e8f0; border-radius:10px;
      font-size:.9rem; background:#f8fafc; color:#475569; font-family:inherit;
    }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }
    .pay {
      width:100%; padding:.85rem 1rem; border-radius:999px; border:0; cursor:pointer;
      background:#f97316; color:#fff; font-size:1rem; font-weight:700; font-family:inherit;
      box-shadow:0 6px 20px rgba(249,115,22,.35); transition:transform .15s, box-shadow .15s;
    }
    .pay:hover { transform:translateY(-1px); box-shadow:0 10px 26px rgba(249,115,22,.45); }
    .cancel {
      width:100%; margin-top:.6rem; padding:.7rem 1rem; border-radius:999px; cursor:pointer;
      background:transparent; border:0; color:#64748b; font-size:.85rem; font-family:inherit;
    }
    .cancel:hover { color:#0b1120; }
    .secure {
      display:flex; align-items:center; justify-content:center; gap:.35rem;
      font-size:.72rem; color:#94a3b8; margin-top:1rem;
    }
    .meta { font-size:.68rem; color:#cbd5e1; margin-top:.75rem; word-break:break-all; text-align:center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <span class="badge">Mode test — paiement simulé</span>
      <p class="label">Montant à payer</p>
      <p class="amount">${escapeHtml(opts.amount)}</p>
    </div>
    <div class="body">
      <div class="field">
        <label for="cc-num">Numéro de carte</label>
        <input id="cc-num" value="4242 4242 4242 4242" readonly />
      </div>
      <div class="grid">
        <div class="field">
          <label for="cc-exp">Expiration</label>
          <input id="cc-exp" value="12 / 34" readonly />
        </div>
        <div class="field">
          <label for="cc-cvc">CVC</label>
          <input id="cc-cvc" value="123" readonly />
        </div>
      </div>
      <form method="post" action="/payments/mock-checkout/${opts.intentId}/confirm">
        <input type="hidden" name="returnUrl" value="${escapeHtml(opts.returnUrl)}" />
        <button type="submit" class="pay">Payer ${escapeHtml(opts.amount)}</button>
      </form>
      <form method="post" action="/payments/mock-checkout/${opts.intentId}/cancel">
        <input type="hidden" name="returnUrl" value="${escapeHtml(opts.returnUrl)}" />
        <button type="submit" class="cancel">Annuler et revenir au site</button>
      </form>
      <p class="secure">&#128274; Aucune carte n'est débitée — environnement de développement</p>
      <p class="meta">intent: ${opts.intentId}</p>
    </div>
  </div>
</body>
</html>`;

const appendStatusParam = (returnUrl: string, status: "success" | "cancel") => {
  try {
    const url = new URL(returnUrl, "http://placeholder.local");
    url.searchParams.set("booking", status);
    return returnUrl.startsWith("http")
      ? url.toString()
      : url.pathname + url.search + url.hash;
  } catch {
    return returnUrl;
  }
};

export class MockCheckoutController {
  protected readonly url = "/payments/mock-checkout";
  protected readonly alepha = $inject(Alepha);
  protected readonly payments = $inject(PaymentService);
  protected readonly provider = $inject(PaymentProvider);
  protected readonly options = $store(mockCheckoutOptions);

  protected isMemoryProvider() {
    // The confirm endpoint is an unauthenticated capture ("mark as paid").
    // An app shipped to production without a real PSP must not silently
    // expose it — production requires an explicit opt-in.
    if (this.alepha.isProduction() && !this.options.allowInProduction) {
      return false;
    }
    return this.provider instanceof MemoryPaymentProvider;
  }

  protected forbidden(reply: ServerReply) {
    reply.headers["content-type"] = "text/html; charset=utf-8";
    reply.status = 403;
    return FORBIDDEN_HTML;
  }

  public readonly mockCheckoutPage = $route({
    method: "GET",
    path: `${this.url}/:id`,
    schema: {
      params: z.object({ id: z.uuid() }),
      query: z.object({ returnUrl: z.text({ size: "rich" }).optional() }),
    },
    handler: async ({ params, query, reply }) => {
      if (!this.isMemoryProvider()) return this.forbidden(reply);
      const intent = await this.payments.getIntent(params.id);
      reply.headers["content-type"] = "text/html; charset=utf-8";
      return renderPage({
        intentId: intent.id,
        amount: formatAmount(intent.amount, intent.currency),
        returnUrl: query.returnUrl ?? "/",
      });
    },
  });

  public readonly mockCheckoutConfirm = $route({
    method: "POST",
    path: `${this.url}/:id/confirm`,
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ returnUrl: z.text({ size: "rich" }).optional() }),
    },
    handler: async ({ params, body, reply }) => {
      if (!this.isMemoryProvider()) return this.forbidden(reply);
      await this.payments.handleWebhookEvent(params.id, "captured");
      reply.redirect(appendStatusParam(body.returnUrl ?? "/", "success"), 302);
    },
  });

  public readonly mockCheckoutCancel = $route({
    method: "POST",
    path: `${this.url}/:id/cancel`,
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ returnUrl: z.text({ size: "rich" }).optional() }),
    },
    handler: async ({ params, body, reply }) => {
      if (!this.isMemoryProvider()) return this.forbidden(reply);
      await this.payments.handleWebhookEvent(params.id, "failed");
      reply.redirect(appendStatusParam(body.returnUrl ?? "/", "cancel"), 302);
    },
  });
}
