import { $inject, t } from "alepha";
import { $route, type ServerReply } from "alepha/server";
import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
import { PaymentService } from "../services/PaymentService.ts";

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
  <title>Mock checkout</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; background:#f6f7f9; }
    .card { background:#fff; padding:2rem; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,.08); max-width:380px; width:100%; }
    h1 { margin:0 0 .25rem; font-size:1.1rem; }
    .badge { display:inline-block; background:#fef3c7; color:#92400e; font-size:.7rem; padding:2px 8px; border-radius:999px; margin-bottom:.75rem; }
    .amount { font-size:2rem; font-weight:600; margin:.75rem 0 1.25rem; }
    .row { display:flex; gap:.5rem; }
    button { flex:1; padding:.75rem 1rem; border-radius:8px; border:0; font-size:.95rem; cursor:pointer; }
    .pay { background:#16a34a; color:#fff; }
    .cancel { background:#e5e7eb; color:#111; }
    .meta { font-size:.75rem; color:#6b7280; margin-top:1rem; word-break:break-all; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">DEV — mock checkout</span>
    <h1>Confirm payment</h1>
    <div class="amount">${escapeHtml(opts.amount)}</div>
    <div class="row">
      <form method="post" action="/payments/mock-checkout/${opts.intentId}/cancel">
        <input type="hidden" name="returnUrl" value="${escapeHtml(opts.returnUrl)}" />
        <button type="submit" class="cancel">Cancel</button>
      </form>
      <form method="post" action="/payments/mock-checkout/${opts.intentId}/confirm">
        <input type="hidden" name="returnUrl" value="${escapeHtml(opts.returnUrl)}" />
        <button type="submit" class="pay">Pay</button>
      </form>
    </div>
    <div class="meta">intent: ${opts.intentId}</div>
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
  protected readonly payments = $inject(PaymentService);
  protected readonly provider = $inject(PaymentProvider);

  protected isMemoryProvider() {
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
      params: t.object({ id: t.uuid() }),
      query: t.object({ returnUrl: t.optional(t.text({ size: "rich" })) }),
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
      params: t.object({ id: t.uuid() }),
      body: t.object({ returnUrl: t.optional(t.text({ size: "rich" })) }),
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
      params: t.object({ id: t.uuid() }),
      body: t.object({ returnUrl: t.optional(t.text({ size: "rich" })) }),
    },
    handler: async ({ params, body, reply }) => {
      if (!this.isMemoryProvider()) return this.forbidden(reply);
      await this.payments.handleWebhookEvent(params.id, "failed");
      reply.redirect(appendStatusParam(body.returnUrl ?? "/", "cancel"), 302);
    },
  });
}
