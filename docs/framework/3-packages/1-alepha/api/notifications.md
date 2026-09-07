# Alepha - Api Notifications

## Installation

Part of the `alepha` package. Import from `alepha/api/notifications`.

```bash
npm install alepha
```

## Overview

User notification management.

**Features:**

- Notification definitions (email/SMS templates)
- Delivery via `$job` with retry and audit trail (`record: "all"` + no ring buffer trim)
- Runtime-editable retention window via `$parameter` - purge cron respects it live
- Admin API for inspecting sent notifications

**Delivery mode** is decided at runtime by the `$job` system:

- If your app loads `AlephaApiJobsQueue` (and thus `AlephaQueue`), notifications
  go through the queue (best for high-volume systems).
- Otherwise, notifications run in **direct** mode: pushed to the outbox table
  and processed in the same process right after the HTTP response is returned.
  The reconciliation sweep is the safety net for crashes / retries.

Direct mode is the recommended default for small / cheap deployments
(Cloudflare Workers, single-instance Node) - no queue infrastructure required.

## ⚠️ An app that uses the inbox owns its deletion cleanup

`notification_inbox.userId` is a bare uuid with **no foreign key**: this
module imports nothing from `alepha/api/users`, so there is no table to
point at and nothing cascades. Deleting an account therefore leaves its
messages behind unless the app removes them.

The seam is `user:delete:before`, and the call is
`NotificationInboxService.deleteForUser(userId)`. Put it in the handler
the app already has there, **after** whatever refusal that handler
performs: a separate handler can run first and wipe the inbox of an
account whose deletion is then refused.

The hourly purge covers the other half, expiry, and only ever removes
messages that have been READ.

## API Reference

### Primitives

- [`$notification`](/docs/reference-primitives-$notification) - Creates a notification primitive: a delivery template, pushed through a

### Providers

- [`NotificationInboxRecipientProvider`](/docs/reference-providers-notificationinboxrecipientprovider) - The seam through which an app turns a contact into one of its users.
- [`NotificationPreferenceProvider`](/docs/reference-providers-notificationpreferenceprovider) - The seam through which an app answers "does this contact accept this
- [`NotificationChannel`](/docs/reference-providers-notificationchannel) - One delivery channel, and the extension point of the whole module.
- [`NotificationEmailChannel`](/docs/reference-providers-notificationemailchannel) - Email, as the first implementation of the channel contract.
- [`NotificationInboxChannel`](/docs/reference-providers-notificationinboxchannel) - The inbox, as the third implementation of the channel contract.
- [`NotificationSmsChannel`](/docs/reference-providers-notificationsmschannel) - SMS, as the second implementation of the channel contract.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable               | Type | Default | Description                                                                                                                                           |
| ---------------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BREVO_WEBHOOK_SECRET` | text | -       | Shared secret Brevo must present on its transactional webhook, as ?secret= on the URL you register. Unset means the webhook route refuses every call. |
