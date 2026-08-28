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

## See also

- [Authentication](/docs/guides-server-authentication) explains why a
  password-reset setting is refused at boot without `features.notifications`.
- [Background Jobs](/docs/guides-server-background-jobs) is the outbox
  underneath all of this.
