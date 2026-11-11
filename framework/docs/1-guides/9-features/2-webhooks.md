# Webhooks

Outbound webhooks: your app tells other systems that something happened, with
a signed `POST` to a URL they gave you, retried until they answer.

Events are declared in code with `$webhook`. Who receives them is data: rows
an operator manages from the admin. A delivery is a job with a log you can
read when a customer says "we never got it".

## Declare and send

Register `AlephaApiWebhooks` (it brings `alepha/api/jobs`), declare an event,
and call `send`:

```typescript check
import { $inject, Alepha, z } from "alepha";
import { $webhook, AlephaApiWebhooks } from "alepha/api/webhooks";

class OrderWebhooks {
  paid = $webhook({
    name: "order.paid",
    description: "An order was paid in full.",
    schema: z.object({ orderId: z.uuid(), total: z.number() }),
  });
}

class Checkout {
  webhooks = $inject(OrderWebhooks);

  async onPaid(orderId: string, total: number) {
    await this.webhooks.paid.send({ orderId, total });
  }
}

const alepha = Alepha.create().with(AlephaApiWebhooks).with(Checkout);
```

`send` validates the data against the schema, then writes one delivery and
pushes one job for every active endpoint subscribed to `order.paid`. With no
endpoint listening it writes nothing. An event name is dotted and lower case,
and unique in the app: receivers subscribe to it by name.

## What a receiver gets

```
POST https://example.app/hooks
content-type: application/json
webhook-id: 0192e4c4-0000-7000-8000-0000000000e1
webhook-timestamp: 1794200000
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

{"id":"0192e4c4-0000-7000-8000-0000000000e1","type":"order.paid","timestamp":"2026-11-09T10:00:00.000Z","data":{"orderId":"...","total":89}}
```

The signature follows the [Standard Webhooks](https://www.standardwebhooks.com)
specification, so a receiver in any language can use an existing library.

## Guarantees

Say these to anyone who builds a receiver, before they assume others:

- **At least once.** A delivery can arrive twice; receivers deduplicate on
  `webhook-id`, which stays the same across retries and redeliveries.
- **Unordered.** Two events can arrive in either order.
- **Retried for about a day.** Eight attempts with full jitter: each wait is
  random under a ceiling of 2 minutes, 8 minutes, 32 minutes, 2 h 08,
  8 h 32, then 18 hours twice, so a failing delivery keeps trying for 24
  hours on average and 48 at most. On Workers without a queue, a retry is
  never sooner than the 15 minute sweep.
- **Inside a transaction, a true outbox.** On Postgres and SQLite a `send`
  inside `$transactional` commits with your write and is delivered right
  after the commit; a rollback sends nothing. On D1 there is no transaction,
  so each write stands alone. Called outside a transaction, `send` is not
  tied to anything you wrote before it. This is the jobs module's rule, see
  [pushing inside a transaction](/docs/guides-features-background-jobs#pushing-inside-a-transaction).
- Any `2xx` is a success. `410 Gone` unsubscribes the endpoint at once.
  Anything else, a redirect included (none is followed), is a failed attempt.

## The admin

Registering the module adds a **Webhooks** page to `AdminRouter` (System
group), behind `admin:webhook:read` and `admin:webhook:write`:

- the endpoints, their status, last success and how long they have been
  failing; create one, pause and resume it, rotate its secret, delete it;
- an endpoint's delivery log: what was sent, what the receiver answered (the
  status and the first 2 KB of the body), how long it took;
- **Redeliver**, which sends a delivery again as a new delivery with the same
  `webhook-id`;
- **Send test event**, which delivers a `webhook.test` event to one endpoint
  and shows the answer.

**Pausing** stops new deliveries: events sent while an endpoint is paused are
skipped, and the deliveries already in flight leave when it is resumed. The
module **disables** an endpoint by itself when the receiver answers `410`,
when it keeps failing for five days (decided on a fresh failure, so an
endpoint with little traffic is not disabled for one bad day), or when its
secret can no longer be read. A disabled endpoint receives nothing until an
operator enables it again.

## Secrets

Each endpoint has its own signing secret, `whsec_` and 32 random bytes. It is
shown **once**, when the endpoint is created and when its secret is rotated,
and never again: the admin shows its first characters only.

**Rotation** keeps the old secret signing beside the new one for 24 hours, so
the receiver can deploy the new one without losing a delivery: during the
overlap the `webhook-signature` header carries two signatures. After a leak,
rotate with `expireNow` to drop the old one at once.

Secrets are stored encrypted with **`APP_SECRET`**. A changed or lost
`APP_SECRET` makes every stored secret unreadable: each endpoint is then
disabled with reason `secret` on its next delivery, needs a rotation, and each
receiver needs its new secret. Keep `APP_SECRET` the way the
[crypto guide](/docs/guides-security-crypto#app_secret) says.

## Where deliveries may go

A webhook sender makes requests to URLs somebody typed into a form, so the
destination is checked when an endpoint is registered or its URL edited, and
again before every delivery.

- **Everywhere:** no credentials in the URL and no fragment. In production:
  `https` only, port 443 (or one listed in `webhookOptions.allowedPorts`), and
  no private, loopback, link-local or local destination written as an address
  (`10.0.0.5`, `[::1]`, `169.254.169.254`, in any spelling) or as a local name
  (`localhost`, `*.local`, `*.internal`, a name without a dot). No redirect is
  followed.
- **On Node and Bun:** before each delivery the host is also resolved, and
  every address it answers is tested, so a public name pointing at a private
  address is refused. A refusal is a failed attempt, retried, since a DNS
  record can be fixed.
- **On Workers:** there is no resolver, so only the written host is tested.
- **The limit.** The check and the request resolve the name separately. A
  resolver under an attacker's control can answer the check with a public
  address and the request with a private one (DNS rebinding), and this does
  not stop it. An app that lets its own customers register URLs, and runs
  where private services are reachable, should weigh that before exposing
  the scoped API below.

Outside production none of the address and port rules apply, so an endpoint
can point at `http://localhost:3000` while you develop. An app that delivers
inside its own network in production sets `allowPrivateDestinations`:

```typescript check
import { Alepha } from "alepha";
import { AlephaApiWebhooks, webhookOptions } from "alepha/api/webhooks";

const alepha = Alepha.create().with(AlephaApiWebhooks);
alepha.store.set(webhookOptions, {
  ...alepha.store.get(webhookOptions)!,
  allowPrivateDestinations: true,
});
```

A payload larger than 256 KB (`maxPayloadBytes`) fails `send` before anything
is written.

## Offering webhooks to your own customers

An endpoint can carry a `scope`, your own tenancy key (an organization id, a
project id). The rule is **fail-closed**: an event sent with a scope reaches
the unscoped endpoints and the endpoints of exactly that scope; one sent
without reaches the unscoped ones only. A scoped endpoint never receives an
event sent without its scope, so forgetting `scope` delivers to your own
endpoints, never to another tenant's.

```typescript check
import { $inject, z } from "alepha";
import {
  createWebhookEndpointSchema,
  WebhookEndpointService,
  webhookEndpointQuerySchema,
  webhookEndpointResourceSchema,
  webhookEndpointWithSecretSchema,
} from "alepha/api/webhooks";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

class CustomerWebhooksController {
  endpoints = $inject(WebhookEndpointService);

  list = $action({
    method: "GET",
    path: "/my/webhooks",
    use: [$secure()],
    schema: {
      query: webhookEndpointQuerySchema,
      response: z.page(webhookEndpointResourceSchema),
    },
    handler: ({ query, user }) =>
      this.endpoints.find(query, { scope: `customer:${user.id}` }),
  });

  create = $action({
    method: "POST",
    path: "/my/webhooks",
    use: [$secure()],
    schema: {
      body: createWebhookEndpointSchema,
      response: webhookEndpointWithSecretSchema,
    },
    handler: ({ body, user }) =>
      this.endpoints.create(body, {
        scope: `customer:${user.id}`,
        userId: user.id,
      }),
  });
}
```

Every operation of `WebhookEndpointService` (get, update, pause, resume,
rotate, delete, the delivery log, redeliver, the test event) takes the same
`{ scope }`, and a row of another scope is not found. Send with the matching
scope: `send(data, { scope: "customer:42" })`. The framework ships no
customer-facing screen for this yet.

## The event catalog and the OpenAPI document

Your integrators' reference is generated from the `$webhook` declarations,
not written by hand:

- `GET /api/webhooks/events` lists every event, its description and the JSON
  Schema of its data (behind `admin:webhook:read`, unless
  `webhookOptions.publicCatalog` is set before the app starts);
- the OpenAPI document served by `$swagger` gains an `x-webhooks` section,
  one entry per event: a `POST` whose body is the envelope with the event's
  own `data` schema, and the three `webhook-*` headers. It is an extension
  key because the document is OpenAPI 3.0, where the `webhooks` field does
  not exist yet (it arrived with 3.1).

## Being told when an endpoint is disabled

Every automatic disable emits `webhooks:endpoint:disabled`, with the
endpoint's id, host, scope and the reason (`gone`, `failing` or `secret`):

```typescript check
import { $hook } from "alepha";

class WebhookAlerts {
  onDisabled = $hook({
    on: "webhooks:endpoint:disabled",
    handler: (event) => {
      console.warn(`Webhooks to ${event.host} disabled: ${event.reason}`);
    },
  });
}
```

To email the user who registered the endpoint, register the notice too (it
needs `alepha/api/notifications`): `alepha.with(WebhookNotifications)`.

## Testing

Under test the module delivers through `MemoryWebhookTransport`: nothing
leaves the process, every request is recorded, and the signature is real, so
you can verify it.

```typescript check
import { Alepha } from "alepha";
import { AlephaApiWebhooks, MemoryWebhookTransport } from "alepha/api/webhooks";

const alepha = Alepha.create().with(AlephaApiWebhooks);
await alepha.start();
const transport = alepha.inject(MemoryWebhookTransport);

// Script a receiver that fails twice, then answers 200.
transport.respondOnce("https://example.app/hooks", { status: 500 });
transport.respondOnce("https://example.app/hooks", { status: 500 });

// ... register an endpoint, send an event ...
transport.wasDelivered("order.paid", "https://example.app/hooks");
transport.lastEnvelope("order.paid");
```

`failNetwork(url)` plays an unreachable receiver. A spec that needs real HTTP
substitutes `HttpWebhookTransport`.

## For the integrator who receives them

This section is written to the receiver; copy it into your own docs.

- **Verify the signature over the raw body**, the bytes you received, before
  parsing it: a parsed and re-serialised body is not the same bytes. The
  scheme is Standard Webhooks, so your language likely has a library. Without
  one, it is twenty lines:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(secret, headers, rawBody) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  return signatures.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const actual = Buffer.from(value, "base64");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
}
```

- **Reject a timestamp more than five minutes away** from your clock, as
  above: it stops a replayed request.
- **Answer `2xx` fast** and do the work afterwards. Anything else, or no
  answer within 15 seconds, is retried.
- **Deduplicate on `webhook-id`**: the same event can arrive more than once.
- **Answer `410 Gone`** to unsubscribe: the sender disables your endpoint.

## Receiving webhooks in an Alepha app

`WebhookVerifier` from `alepha/security` verifies a Standard Webhooks request,
from an Alepha app or any other sender, without the webhooks module. Declare
the route **without** `schema.body`, so the bytes arrive unread, and outside
`/api`, which is the actions' namespace:

```typescript check
import { $env, $inject, z } from "alepha";
import { WebhookVerifier } from "alepha/security";
import { $route } from "alepha/server";

class IncomingWebhooks {
  env = $env(z.object({ ORDERS_WEBHOOK_SECRET: z.text() }));
  verifier = $inject(WebhookVerifier);

  orders = $route({
    method: "POST",
    path: "/hooks/orders",
    handler: async (request) => {
      const event = await this.verifier.verifyRequest(request, {
        secret: this.env.ORDERS_WEBHOOK_SECRET,
      });
      // event.id, event.type, event.data
      return "ok";
    },
  });
}
```

A request that fails verification is refused with
`InvalidWebhookSignatureError`, a `401`. `secret` also takes an array, for a
sender rotating its secret.
