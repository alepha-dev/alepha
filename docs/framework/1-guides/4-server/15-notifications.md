# Notifications and Email

Two layers, and picking the wrong one is the most common mistake.

`$email` sends a message you have already written. `$notification` declares a
**template** and pushes it through a durable outbox, with retries, an audit
trail, a suppression list and delivery receipts.

```typescript check
import { $email } from "alepha/email";
import { $notification } from "alepha/api/notifications";
```

Use `$email` when the app itself decides the words at the moment of sending
(commerce's order mail does this). Use `$notification` for anything a
recipient might later want to stop receiving, or that you will one day be
asked "did it arrive?" about.

> Notification mail does **not** pass through `$email`. The sender calls the
> provider directly, so the `email:sending` / `email:sent` hooks only ever see
> `$email` callers. Delivery information for notifications comes from the
> receipt instead, not from a hook.

## 1. Declaring a template

```typescript
import { z } from "alepha";
import { $notification } from "alepha/api/notifications";

class Notifications {
  welcome = $notification({
    category: "onboarding",
    schema: z.object({ name: z.text() }),
    email: {
      subject: "Welcome",
      body: (vars) => `<h1>Hello ${vars.name}</h1>`,
    },
  });
}
```

| option         | what it changes at send time                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| `schema`       | validates `variables` on every push                                                 |
| `category`     | what an unsubscribe link switches off                                               |
| `critical`     | bypasses `unsubscribed`, carries no unsubscribe header, pushes at critical priority |
| `sensitive`    | withholds variables, subject and body from the admin view and the receipt           |
| `translations` | per-language `subject` / `body`, resolved from the recipient's language             |

`critical` is for messages the recipient needs in order to use their account:
a password reset, a sign-in code. It is not a way to make marketing arrive.

## 2. Writing the body, and its three sharp edges

A body is `string | ((variables) => string | Promise<string>)`. There is
deliberately **no template engine**: no `{{var}}` syntax, no database-stored
templates, no live editing. A custom syntax is unlearnable and untypable, and
a template edited in an admin UI is unversioned state that no longer matches
the code deployed against it.

`subject` and `text` take the same union, and see the same variables plus
`unsubscribeUrl`. Build the subject whenever the message is about something
in particular: the subject line is what a phone shows in its notification, so
a sign-in code that is only in the body is a code the recipient has to open a
mail client to read.

```typescript
email: {
  subject: (vars) => `Your code is ${vars.code}`,
  body: (vars) => `<p>${vars.code}</p>`,
}
```

A built subject can carry a name or an amount, which is what `sensitive`
above is for: it keeps the subject off the delivery receipt.

Three things the framework does not do for you:

**Nothing escapes for you.** Interpolating a user-supplied value into HTML is
an injection. The framework's own templates only interpolate values it
generated itself (a code, a URL, the recipient's own address), so they are
safe; the first app that puts a display name in a body and does not escape it
is not.

```typescript
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

body: (vars) => `<p>${escapeHtml(vars.inviterName)} invited you</p>`;
```

**Bodies are fragments, not documents.** Every provider is handed `body` as
the HTML part, with no `<!DOCTYPE>`, no `<html>`, no charset. Clients tolerate
it. An app that wants an Outlook-safe shell builds one itself.

**RTL is the app's job.** A bare fragment in Arabic or Hebrew renders
left-to-right. If you ship a shell, wrap it in `dir="rtl"` for RTL recipients.

## 3. React templates

```typescript check
import { render } from "alepha/react/email";
```

```tsx
const WelcomeEmail = (props: { name: string }) => (
  <html lang="en">
    <body>
      <h1>Hello {props.name}</h1>
    </body>
  </html>
);

welcome = $notification({
  schema: z.object({ name: z.text() }),
  email: { subject: "Welcome", body: render(WelcomeEmail) },
});
```

`render()` takes the **component**, not an element: an element would have to
be built before any variables exist.

`@react-email/components` (Outlook-safe tables, `<Tailwind>`, `<Button>` with
VML fallbacks) works through this unchanged. Install it in your app;
the framework does not depend on it, and deliberately does not use
`@react-email/render` either, which ships `prettier` in its edge build.

A template gets **props, not the container**: no `useI18n()` or `useInject()`
inside an email component. Use `translations` for language.

## 4. Sending

```typescript
await this.welcome.push({
  contact: "a@example.com",
  variables: { name: "Alice" },
});

await this.reminder.pushMany({
  contacts: roster.map((p) => ({
    contact: p.email,
    variables: { name: p.name },
  })),
  organizationId: club.id,
});
```

`push` also takes `scheduledAt`, `delay` and `key`.

> **`scheduledAt` is bounded by the sweep, not the minute.** A future date
> writes a `scheduled` row that the sweep promotes on its next tick (every 15
> minutes by default), so "remind at 09:00" means "at the first tick at or
> after 09:00".

> **`key` is concurrency dedup, not idempotence over time.** The job layer
> clears the key on **both** terminal states, success and failure alike. A
> repeated key returns the first execution only while it is still pending,
> running or scheduled; once the send has completed, the same key pushes a
> second row and sends a second message. For "at most one reminder per day",
> keep your own marker on the subject row.

Outside a request there is no tenant and no language to infer, so **pass
`organizationId` explicitly from a cron**, and give each contact its own
`lang` if it matters.

## 5. Suppression and preferences

One table, three reasons, two strengths:

| reason         | blocks                                      |
| -------------- | ------------------------------------------- |
| `unsubscribed` | non-critical mail, in the matching category |
| `bounced`      | everything, `critical` included             |
| `complained`   | everything, `critical` included             |

A password reset still reaches someone who unsubscribed from reminders.
Nothing reaches an address that hard bounced.

Your own product preferences live behind a seam:

```typescript check
import { NotificationPreferenceProvider } from "alepha/api/notifications";
```

An implementation must consider **both axes**: a channel switched off
entirely, and one category refused. "No email at all" and "no email about
this" are different answers, and an unsubscribe link expresses the second.

The gate runs at **send** time, never at push time: a suppression can land in
between, and the send-time answer is the authoritative one. A refused send
returns without throwing, so the job completes and no retry fights the gate.

## 6. Unsubscribe

Non-critical mail carries `List-Unsubscribe` and `List-Unsubscribe-Post`
automatically, and the body can render the same URL from an `unsubscribeUrl`
variable. Both need `PUBLIC_URL`; without it the headers are omitted rather
than made relative.

The token is a stateless HMAC over `(organizationId, contact, channel,
category, template)` with **no expiry**, because a link in a six-month-old
mail must still work.

> ⚠️ **Rotating `APP_SECRET` invalidates every outstanding unsubscribe link**,
> in mail already delivered, with no fallback and no way to tell the
> recipients. That is the price of not having a token table. An app that
> rotates secrets on a schedule needs to know this before it does.

## 7. Delivery receipts

Every send writes one receipt, on all three outcomes: `sent`, `skipped` (the
gate refused it) and `failed` (the provider threw). Provider events then
update it to `delivered`, `bounced`, `complained` and so on.

**Two retention clocks.** The job outbox keeps `retentionDays` (7 by
default); receipts keep `receiptRetentionDays` (90), because a complaint can
arrive weeks after the send. The admin detail view joins the outbox row when
it still exists and renders correctly when it does not.

`storeRenderedBody` is **off by default**: 90 days of full HTML for every
notification is real bytes, and a fan-out over a roster multiplies it. The
subject is always kept, except on a `sensitive` template.

To ingest bounces and complaints:

- **Cloudflare**: create an Email Sending event subscription (per sending
  domain) onto a queue, and set `CLOUDFLARE_EMAIL_EVENTS_QUEUE`. No producer
  binding is needed; an app running jobs in direct mode still gets its events.
- **Brevo**: point a transactional webhook at
  `/notifications/webhooks/brevo?secret=…` and set `BREVO_WEBHOOK_SECRET`. An
  unset secret refuses every call.
- **SMTP**: no async events exist. Bounces arrive as mail to the `From`
  address and are out of scope.

Only a **hard** bounce suppresses. Cloudflare marks every `message.bounced`
terminal, including ones that merely exhausted temporary retries; the split
is `payload.bounce.type`.

Two admin permissions, deliberately not one: `admin:notification:send`
resends a message, `admin:notification:write` lifts a suppression. An operator
trusted with the first is not automatically trusted with the second.

## 8. Attachments

An attachment is a **reference** resolved at send time, never bytes in the
queued payload:

```typescript
await this.invoice.push({
  contact: customer.email,
  variables: {},
  attachments: [{ storage: "invoices", fileId: stored.id }],
});
```

The payload is a JSON column that is logged, retried and kept; a base64'd PDF
in there is a row nobody can read and a queue message over Cloudflare's 128 KB
limit. Count and total-size caps live on the `api.notifications`
parameter, and a missing object **fails the send** rather than delivering an
invoice email with no invoice.

Note that an attachment on bulk mail is a stronger spam signal than the same
mail without one.

## 9. Providers

| provider   | module                    | needs                                                                                   |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------- |
| SMTP       | `alepha/email/smtp`       | `EMAIL_HOST`, `EMAIL_FROM`, optionally `EMAIL_USER` / `EMAIL_PASS`                      |
| Brevo      | `alepha/email/brevo`      | `BREVO_API_KEY`, `EMAIL_FROM`                                                           |
| Cloudflare | `alepha/email/cloudflare` | a `SEND_EMAIL` binding, or `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` off Workers |
| Local      | built in                  | writes `.eml.json` files under `DATA_DIR`, which is what the devtools outbox reads      |
| Memory     | built in                  | the default under test                                                                  |

Cloudflare takes a `to: string[]` as **one** message (50 recipients max) and
returns one id; Local and Memory fan out to one record per recipient. The
notification layer always pushes one job per contact, so receipts line up
one-to-one.

`headers` cannot set `From`, `To`, `Subject`, `Cc`, `Bcc`, `Reply-To` or
`Content-Type`: those are refused, not stripped, because a caller-controlled
header map is otherwise a spoofing surface. Use the `replyTo` option.

## 10. Previewing and testing

In development the Local provider writes every message to `DATA_DIR`, and
`@alepha/devtools` renders them in its **Outbox** view, emails and SMS
together. That is the preview: send the thing and look at it.

In tests, use `MemoryEmailProvider`:

```typescript
const mail = alepha.inject(MemoryEmailProvider);
expect(mail.last?.subject).toBe("Welcome");
expect(mail.last?.text).toContain("Hello Alice");
```

Records carry `to`, `subject`, `body`, `text`, `replyTo`, `headers`,
`attachments` and `messageId`.

> `travel()` fires **every** cron in the container, including the notification
> purge. Assert end state (which rows exist), never call counts.

## 11. SMS, without the notification layer

`$notification` is a template with preferences, suppression, receipts and an
outbox behind it. `$sms` is the layer below: a named channel that hands a
pre-rendered string to whichever provider is configured.

```typescript check
import { $sms } from "alepha/sms";

class Verification {
  code = $sms({ name: "verification-code" });

  async sendCode(to: string, code: string) {
    await this.code.send({ to, message: `Your code: ${code}` });
  }
}
```

`send()` takes `to` (one number or a list) and `message`. There is no template
rendering and no subject: build the string yourself.

Declare a channel per purpose rather than one per app. The name is what appears
in the `sms:sending` and `sms:sent` hooks and in the devtools outbox, so
`verification-code` and `delivery-update` stay distinguishable where a single
`sms` channel would not.

| Provider | Selected by                           | Does                                              |
| -------- | ------------------------------------- | ------------------------------------------------- |
| Local    | development default                   | Writes files under `DATA_DIR` for the outbox view |
| Memory   | `$sms({ provider: "memory" })`, tests | Keeps records in `records` / `last`               |
| Your own | `provider: MyGatewayProvider`         | Extend `SmsProvider` and implement `send()`       |

Both hooks fire around every send. `sms:sending` carries an `abort()` that
throws, which is where a global opt-out or a test-environment guard belongs:

```typescript
alepha.events.on("sms:sending", ({ to, abort }) => {
  if (!isOptedIn(to)) {
    abort();
  }
});
```

Under test, `MemorySmsProvider` exposes `records` and `last`, the same shape as
`MemoryEmailProvider`.

Use `$sms` directly for a transactional string a person is waiting on right now
(a login code). Use `$notification` when the message is something a user could
reasonably want to turn off, because that is what the preference and suppression
machinery exists for.

## 12. Writing a channel

`email` and `sms` are not special. Each is a `NotificationChannel` service
registered in the notifications module, and a package outside the framework
adds its own the same way. `@alepha/discord` is the worked example: it posts
an ops message into a Discord room through an incoming webhook, and it is
about two hundred lines.

A channel is **three** declarations, and missing one of them is the usual
mistake.

### The class

```typescript check
import {
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "alepha/api/notifications";

interface PagerMessage {
  to?: string;
  message: (variables: Record<string, unknown>) => string | Promise<string>;
}

export class PagerChannel extends NotificationChannel<PagerMessage> {
  public readonly channel = "pager";
  public readonly addressable = false;

  public async render(input: NotificationRenderInput<PagerMessage>) {
    const to = input.message.to ?? "ops";
    return {
      recipient: `pager:${to}`,
      body: await input.message.message(input.variables),
    };
  }

  public async send(rendered: NotificationRendered) {
    // POST it somewhere. Throwing is how a failure is reported: the sender
    // writes a `failed` receipt and the job retries.
    return { messageId: undefined };
  }
}
```

`render` and `send` are split because the admin preview renders without
sending. There is no target parameter: an addressable channel's recipient is
on the payload, and a sink's destination comes from its own option block.

### The two declaration merges

```typescript
declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    pager?: {
      to?: string;
      message: (variables: V) => string | Promise<string>;
    };
  }

  interface NotificationSinkChannels {
    pager: true;
  }
}
```

The first is what makes `$notification({ pager })` typecheck, and the generic
`V` is what lets `message` see the template's own variables. The second says
this channel is a **sink**, and it is the one people forget: without it,
`push()` on a pager-only template still demands a `contact` for a message
going to a room.

Put both in the package's single entry point. An augmentation applies only
where it is in scope, so a subpath export makes "import the module, get the
types" quietly untrue.

### The registration

```typescript
export const AlephaPagerNotifications = $module({
  name: "alepha.notifications.pager",
  imports: [AlephaApiNotifications],
  services: [PagerChannel],
});
```

> ⚠️ **`services[]`, not merely `export`.** Discovery is
> `alepha.services(NotificationChannel)`, which filters **instantiated**
> services, so a channel nobody injects is invisible to the registry. The
> symptom is confusing: the framework's boot check refuses a template that
> declares your own channel.

### Addressable, or a sink

|                               | `addressable: true` | `addressable: false`          |
| ----------------------------- | ------------------- | ----------------------------- |
| goes to                       | a person            | a place named in the template |
| `contact` on `push()`         | required            | optional                      |
| suppression list              | checked             | skipped                       |
| preference provider           | asked               | skipped                       |
| unsubscribe token and headers | minted              | none                          |
| `recipient`                   | the contact         | `<channel>:<destination>`     |

The gate is skipped for a sink deliberately. A suppression row spelled
`discord:alerts` would be indelible: nobody can click an unsubscribe link for
a chatroom, so one stray bounce would silence an ops alert for good.

### Two members that look optional and are not

`render()` must return a **`recipient`**. It is written straight into the
delivery receipt's `contact` column, which is `NOT NULL`, and it is the whole
reason the sender never branches on the kind of channel.

**`providerName()`** should be overridden by a channel that is an adapter over
a swappable transport, so a receipt names the transport rather than the
adapter. The default is the channel's own class name, which is right for a
channel that IS its transport. `NotificationEmailChannel` overrides it so a
receipt keeps saying `BrevoEmailProvider`; nothing asserts on that field by
default, so getting it wrong degrades the audit trail silently.

### Configuration belongs in an atom

A sink's destination is usually a credential. Keep it in an `$atom`, never in
template code: the template names a destination, and the channel resolves it.

```typescript
alepha.set(discordOptions, {
  destinations: {
    alerts: { webhook: process.env.DISCORD_ALERTS!, default: true },
    releases: { webhook: process.env.DISCORD_RELEASES! },
  },
});
```

A receipt then records `discord:releases`, and the webhook reaches neither the
outbox row nor the admin preview. The preview cannot leak it by construction:
a channel carries whatever it likes in its own private rendered type, and the
controller returns only `NotificationRendered`'s base fields.

`to` should be a literal string, never a function. Dynamic routing reduces a
boot check to "the map is not empty" and puts a typo'd destination back at
3am. A template that needs two rooms declares two channel blocks.

### Fail at boot, not at 3am

The framework refuses to boot when a template declares a channel nothing
provides, naming the template, the channel and the module to import. A plugin
should add its own half in a `$hook({ on: "start" })`: that every destination
exists, that at most one is flagged `default`, and that every `to` a template
names is configured.

## See also

- [Authentication](/docs/guides-server-authentication) explains why a
  password-reset setting is refused at boot without `features.notifications`.
- [Background Jobs](/docs/guides-server-background-jobs) is the outbox
  underneath all of this.
