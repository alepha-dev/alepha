# Healthchecks

A healthcheck asks from outside whether something is up: a website, a port, a
TLS certificate, or a scheduled job that should have reported in. It needs no
sigil and no app. This page covers the four kinds of monitor, how a check becomes
an outage, and what happens when one opens.

## Turning it on

Healthchecks are the **Healthchecks** option of the Apps capability, off by
default, in **Settings ▸ General ▸ Capabilities**. It adds **Uptime** to the
sidebar, at `/<project-slug>/uptime`.

Reading monitors needs `app:read`, which the default Member rank holds, and works
with the option off. Creating, editing, pausing and deleting them needs `app:manage` and
the option on. With the option off, no checks run and every push is refused,
but nothing is deleted.

## Adding a monitor

**Add monitor** opens the form. If a copy of an app has an address and nothing
checking it, and is not ephemeral, the page offers it under **Apps without a
monitor**, and **Add monitor** beside it fills in the name and the URL.

| Kind            | Target                            | Up means                                                                             |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| HTTP(S)         | An `http` or `https` URL          | A `GET` answers a 2xx, or the expected status, and contains the keyword if one is set. A redirect is not followed. |
| TCP port        | `host:port`                       | The connection opens.                                                                |
| TLS certificate | `host:port` (the port defaults to 443) | The certificate is valid and further from expiry than the warning.                   |
| Push receipt    | None: Lore gives you a URL        | The URL was called within the interval.                                              |

A target cannot carry credentials. The kind cannot change after creation: create
a new monitor instead.

| Setting               | Default | Range                       | What it does                                                 |
| --------------------- | ------- | --------------------------- | ------------------------------------------------------------ |
| Interval              | 60 s    | From 60 s, in whole minutes | How often it is checked. On a push monitor, labelled **Stale after**, the silence allowed. |
| Timeout               | 10 s    | 1 to 30 s                   | How long a check waits.                                      |
| Failures before down  | 2       | 1 to 100                    | Consecutive failures that open an outage.                    |
| Expected status       | 2xx     | 100 to 599                  | HTTP only.                                                   |
| Body keyword          | none    | Up to 1,000 characters      | HTTP only. The response must contain it, and be under 2 MiB. |
| Latency budget        | none    | In milliseconds             | HTTP only. Over budget is recorded, and the monitor stays up. |
| Warn before expiry    | 14 days | 0 to 365 days               | Certificates only. Closer than this counts as a failure.     |

⚠️ **TCP and certificate monitors need a Node host.** They open a raw socket,
which Cloudflare Workers cannot do, so on a Workers deployment such a monitor
fails every check with a message saying so. HTTP and push monitors work on both.
`lore.alepha.dev` runs on Workers; a
[self-hosted image](/lore/docs/guides-self-hosting) runs on Node.

## Push monitors

A push monitor watches something that runs on its own schedule, such as a backup
or a cron job. It is the one kind Lore does not call: the job calls Lore.

Creating one shows a private URL, **once**:

```bash
curl -fsS https://lore.alepha.dev/uptime/push/up_...
```

Call it when the job succeeds. Each call answers 204 and restarts the clock. If
nothing arrives within the interval, the check fails. Lore looks every minute,
so an interval of 3600 means an hour of allowed silence, not an hourly check.

The URL can do one thing, which is record a receipt for that monitor, and only
its hash is stored. **Rotate push URL** replaces it, and the old one stops
working.

## From failures to an outage

Lore checks due monitors every minute. A failed check is not yet an outage: the
monitor goes **Down** once **Failures before down** checks fail in a row, and a
single success brings it back **Up**.

| Status  | Meaning                                                         |
| ------- | --------------------------------------------------------------- |
| Pending | No check has passed yet, and failures are below the threshold.  |
| Up      | The last check passed, or failures since are below the threshold. |
| Down    | An outage is open.                                              |
| Paused  | **Pause** stops the checks. **Resume** starts them again.       |

Pausing a monitor keeps an outage that was already open, and resuming shows it
**Down** again until a check passes.

When an outage opens:

- **An incident** is recorded, with its cause and start. It closes when the
  monitor recovers.
- **A blight** named `UptimeOutage` appears in the project's
  [Blights](/lore/docs/guides-telemetry#blights) inbox, one per monitor, with the
  monitor, the target and the failure. It is resolved by itself on recovery, and
  the next outage opens it again. The inbox stays reachable while it is open,
  even with no sigil in the project. It follows the retention of any open blight,
  so an outage that outlasts that window loses it.
- **An email** goes out, and a second one on recovery.

One outage means one pair of emails, however long it lasts. There is no reminder
while a monitor stays down, and no webhook.

### Who is alerted

Email alerts are on for a new monitor. **Recipients** takes up to 20 addresses,
separated by commas. Left blank, the alert goes to the project's current owner.
They arrive in the **Healthchecks** category of
[notification preferences](/lore/docs/guides-notifications#turning-messages-off),
so a recipient with an account can turn them off.

## Reading a monitor

The **Uptime** page lists every monitor with its status and its recent checks.
Opening one shows:

- **Uptime** over 24 hours, 7 days and 30 days, from hourly totals.
- **Mean latency**, over successful checks only. A gap means no successful
  sample, never zero.
- **Recent checks**: the last 50, each with its result.
- **Incident history**: the latest 100, with exact durations.
- The certificate's expiry, where one was seen.

Lore keeps the newest 100 individual checks per monitor, and hourly totals for
the charts. On a backend that samples, the page says the numbers are estimated.

**Delete** removes the monitor, its checks and its incidents. The hourly totals
stay in the analytics store, and a blight still open stays for you to resolve.

A copy of an app shows the HTTP monitor on its address on its **Overview** tab.
The link is that URL and nothing else: a monitor added by hand for the same
address counts.

## For agents

There is no MCP tool for healthchecks. An outage reaches an agent as a blight, so
`blight_list` shows it under the name `UptimeOutage`.
