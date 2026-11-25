# Notifications

Lore tells you about things in two ways. Some messages are addressed to you
by name: a mention, an answer to your report, an invitation. Others follow
what happens in a project: a release published, a deploy failed, a host gone
offline. You choose those yourself, or a manager chooses them for you, on
**Settings ▸ Notifications**. This page covers both, the channels they travel
on, and the messages you can turn off.

## The bell and the inbox

The bell in a project's header shows how many messages you have not read,
across **every** project, and opens a list of the latest ones. **See all**
opens the full inbox: the **Inbox** section of your account dialog, on all
projects.

In the inbox:

- A message shows its title, a preview, its project and when it arrived. An
  unread one has a dot and a heavier title.
- Clicking a message marks it read and opens what it is about.
- **Mark all read** marks every message the list shows.
- The **Project** filter narrows the list to one project; cleared, it reads
  **All projects**, the default.
- The search box filters what is loaded on the page, by title and preview, and
  **Load more** brings the next 25.

The inbox belongs to your account, not to a project: the bell, the account
dialog and the command palette, under **Notifications**, are the ways in. A
link ending in `?account=inbox` opens it from anywhere in Lore.

Messages are yours alone: nobody else can read them, and there is no permission
to grant.

## Messages addressed to you

| Message                       | Sent to                                                    | Inbox | Email |
| ----------------------------- | ---------------------------------------------------------- | ----- | ----- |
| A mention                     | A member named with `@name` in a quest or feedback comment | Yes   | Yes   |
| A report accepted or rejected | The person who [filed it](/lore/docs/plan-feedback)        | Yes   | Yes   |
| A report answered             | The person who filed it                                    | Yes   | Yes   |
| A project invitation          | The person invited                                         | Yes   | Yes   |

A few rules explain what you will and will not receive:

- **Your own actions send you nothing.** A report you triage yourself does not
  notify you.
- **One event, one message.** A comment that both answers a report and names
  its author sends a single message.
- **An invitation reaches the bell only when its address already has an
  account.** The bell links to your **Invitations** page. The email alone
  carries the one-time link. Accepting the invitation marks its message read.
- **An agent's comment is a comment too.** `@name` in a comment an agent
  writes reaches that member, the owner of the API key the agent works as
  included. That is how an agent asks you for a decision.

## Project events

Everything else a project tells you about is a **project event**: something
that happened, recorded once, with what it is about. You are told about an
event only if you, or a manager, chose to be. Events you are not subscribed
to are still recorded, and an agent can read the recent ones (see
[From an agent](#from-an-agent)).

| Resource | Events                                                                                 | Needs                     |
| -------- | -------------------------------------------------------------------------------------- | ------------------------- |
| Quests   | Quest created, Quest accepted or assigned, Quest put on hold, Quest completed          | Plan                      |
| Quests   | Quest reminder due                                                                     | Plan, with **Reminders**  |
| Epics    | Epic created, Epic marked ready, Epic completed                                        | Plan, with **Epics**      |
| Quests   | Pull request added                                                                     | Plan                      |
| Releases | Release published                                                                      | Plan, with **Releases**   |
| Feedback | New feedback                                                                           | Plan, with **Feedback**   |
| Apps     | Deploy failed, Deploy succeeded                                                        | Ship, with **Deploy**     |
| Monitors | Monitor down, Monitor recovered                                                        | Ship, with **Uptime**     |
| Hosts    | Host token stopped working, Host past its time to live, Host offline, Host back online | Ship                      |
| Quality  | Coverage under its threshold                                                           | Reports, with **Quality** |
| Errors   | Open errors over their threshold                                                       | Ship                      |
| Jobs     | Agent job succeeded, Agent job failed                                                  | none                      |
| Prompts  | Prompt disabled, Prompt ceiling reached                                                | none                      |

An event whose capability or option is off in the project shows as
**Unavailable**, with the switch that turns it on. Deploy, monitor and host
events can be narrowed to one app, one monitor or one host: **Only for this
app** (or monitor, or host) in the form, or **Any**.

The message is fixed: Lore writes it from the event, in the recipient's
language, with a link to what it is about. It cannot be edited.

### The bell on a page

The quickest way to subscribe is the bell on the page concerned: a monitor, a
host, the Apps list, the Releases list, the Feedback inbox. One click
subscribes you, in the app, to every event the bell covers, and the bell then
reads **You are notified**. Clicked again, it opens a dialog that chooses how
(in the app, by email, or both) and, for a bell over several events, which
ones; it then reads **You are notified of part of it** when you kept only some.
The same dialog stops it, with **Stop notifying me**.

![A monitor's bell, clicked again: how, and of what](/screenshots/lore/notifications-bell-light.png)

A bell is a shortcut to the same subscriptions **Settings ▸ Notifications**
lists: what you set with one shows on the other.

## Settings ▸ Notifications

The **Notifications** tab is a table of who is notified of what in the
project: one row per subscription, with its **Event**, the **Member** (or
channel) told, its filter under **Only for**, the **Channel** and its
**Status**. The rows are grouped
by resource; the picker beside the search groups them by recipient instead,
or not at all. The counters above the table (**Mine**, **Paused**) are quick
filters, and the filter bar narrows the list by resource, recipient, way and
status.

**Notify someone** opens a dialog:

- **When**: the event, and its filter where it has one. An event the project
  cannot emit is listed as **Unavailable**, with the switch that turns it on.
- **Notify**: **Me**, another member, or one of the project's channels.
- For a member, **Inbox** and **By email**, one or both.

From the command line or an agent, a member's subscription can also skip the
events that member caused, such as a report they filed themselves:
`--not-mine` on `lore subscription set`, `not_mine` on `subscription_set`. And
any subscription can skip the events a project member caused, so only outside
reporters' feedback is told: `--not-members`, `not_members`. The feedback
inbox's bell offers both.

Each row's menu has **Pause** (then **Resume**) and **Stop**, and both act on
a selection of rows too. A paused subscription keeps its place and sends
nothing until it is resumed.

![Settings > Notifications, listing who is notified of what](/screenshots/lore/notifications-light.png)

### Who can notify whom

| Permission                                             | What it allows                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| See who is notified of what                            | Read the whole list, not only your own subscriptions.             |
| Notify other members and manage the project's channels | Subscribe any member, add and edit channels, subscribe a channel. |

Without either, a member sees only their own subscriptions and changes only
those. Either way, a member is told about an event only while they still
belong to the project and hold the permission to read what it is about: a
member who cannot see the project's hosts receives no host event, even if a
manager subscribed them. Nothing is refused at the time; the message is
simply not sent.

![Notifying another member: the form with a member picked under Notify](/screenshots/lore/notifications-member-light.png)

## Channels

The **Channels** tab, next to **Notifications**, lists where messages can go.

| Kind    | Where it goes                                                   |
| ------- | --------------------------------------------------------------- |
| Inbox   | The recipient's inbox in Lore. Built in.                        |
| Email   | The recipient's address. Built in.                              |
| Discord | A Discord channel, through a Discord webhook URL.               |
| Webhook | A URL of yours, which Lore calls with the event.                |
| Room    | An open room of the project's chat, where Lore posts the event. |

Inbox and Email belong to each member and need no setup. Discord and webhook
channels belong to the project: whoever may manage the project's channels adds
them with **Add a channel**, which opens a dialog, and subscribing one sends
every matching event there, whoever reads it. Lore checks a Discord URL with a
test message, then never shows it again; **Rename or replace URL**, in the
row's menu, changes it. Deleting a channel deletes the subscriptions that use
it.

A **Room** channel takes a room instead of a URL and a name: Lore posts each
event there as a message of its own, for everyone in the room to read. The
channel is named after its room, **Room #general**, and follows it when the
room is renamed. Only open rooms are offered. Once its room is archived, the
channel receives nothing and reads **Room archived**.

![The Channels tab, with a webhook channel](/screenshots/lore/notifications-channels-light.png)

### Webhooks

A webhook channel calls its URL with one `POST` per event, signed with the
[Standard Webhooks](https://www.standardwebhooks.com) scheme, and retries a
call that fails. Private and loopback addresses are refused.

The body is JSON:

```json
{
  "id": "01937c4e-7b1a-7c2e-9f4d-2b6f1d8a9e01",
  "type": "deploy.failed",
  "timestamp": "2026-11-18T10:00:00.000Z",
  "data": {
    "project": { "id": 7, "title": "Acme" },
    "subject": {
      "kind": "deployment",
      "id": "01937c4e-5d2f-7b10-8c3a-6e4f0a1b2c3d"
    },
    "fields": {
      "project": "Acme",
      "title": "web",
      "app": "web",
      "env": "production",
      "tag": "v1.4.0",
      "reason": "Health check failed",
      "url": "/acme/apps/web/production/deploy"
    },
    "url": "https://lore.example.app/acme/apps/web/production/deploy"
  }
}
```

- `id` is the event's own id. It does not change across retries, so a receiver
  that has seen it can ignore the call.
- `type` is the event's name, as the table above lists them in Lore: for
  example `release.published`, `monitor.down`, `host.offline`.
- `data.fields` holds what the event says about its subject; which fields an
  event carries is listed by `lore event catalog`.

Three headers come with every call: `webhook-id` (the body's `id`),
`webhook-timestamp` (seconds since the epoch) and `webhook-signature`.

When the channel is created, Lore shows its **signing secret** once: a value
starting with `whsec_`. To check a call, take the base64 part after
`whsec_`, decode it, and compute an HMAC-SHA256 with it over
`<webhook-id>.<webhook-timestamp>.<raw body>`. Its base64 must equal one of the
space-separated `v1,<signature>` entries of `webhook-signature`. Refuse a
timestamp more than a few minutes old, so a recorded call cannot be replayed.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signed).digest();
  const age = Math.abs(
    Date.now() / 1000 - Number(headers["webhook-timestamp"]),
  );
  if (age > 300) return false;
  return headers["webhook-signature"].split(" ").some((entry) => {
    const given = Buffer.from(entry.replace(/^v1,/, ""), "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

Any Standard Webhooks library does the same check. **New secret** gives the
channel a new signing secret; the previous one keeps signing for 24 hours, so
the receiver can switch without missing a call.

## Quest reminders

With **Reminders** on (**Settings ▸ Plan ▸ Quests**), whoever holds a quest
can ask for a daily, weekly or monthly nudge on it, from the quest's
**Reminder** panel. Lore checks every hour, at the top of the hour, and sends
each reminder due once, to the quest's assignee, in the app and by email
(as their own preferences allow). A quest of an epic still in draft is not
reminded.
Turning **Reminders** off stops them without clearing them: they resume when
it comes back on.

A reminder is also a project event, **Quest reminder due**, so a channel can
be told about it too.

## Thresholds

Two events fire when a number crosses a line you set:

- **Coverage under its threshold**: set on **Settings ▸ General ▸ Quality**. It is checked
  when a push on `main` reports its coverage.
- **Open errors over their threshold**: set on **Settings ▸ Errors**. It is
  checked every hour.

Each fires once when the line is crossed, and again only after the value has
come back to the right side of it. An empty threshold means no alert. Who is
told is set like any other event, on **Settings ▸ Notifications**.

## What Lore does not do

Lore tells people and systems that something happened. A subscription runs
nothing for you:

- no schedule ("every Monday at nine"), apart from quest reminders;
- no condition ("only if the release has more than ten quests");
- no action on quests, folios or anything else in Lore;
- no message of your own: the text is the event's.

For any of those, react to the event where you have the tools to:

- **A prompt's trigger** runs a prompt on one of your Agent hosts on an
  event or a schedule: a triage of each new report, the work of each new
  quest. See [Prompts](/lore/docs/agents-prompts#triggers-runs-that-start-on-their-own).
- **A scheduled agent session** connected over MCP reads the project, decides,
  and writes back: a weekly digest, a triage pass, a folio kept up to date.
  See [Connecting an agent](/lore/docs/agents-connecting).
- **A webhook channel** hands each event to your own code, which can do
  anything with it.

## Turning messages off

Open your account and choose **Notifications**. The preferences there apply to
you in every project.

- **Email** turns off everything that would be mailed to you, except the
  security mail your account depends on, such as sign-in codes and password
  resets.
- **Inbox** has no switch: the inbox is always on.
- **Kinds of message** are switches that apply to both channels at once.
  Sign-in codes and password resets are not listed, and stay on whatever you
  mute here.

| Kind                  | What it covers                                                                  |
| --------------------- | ------------------------------------------------------------------------------- |
| Project notifications | Project events you, or a manager, chose to be notified of.                      |
| Your reports          | A project accepts, rejects or answers a report you submitted.                   |
| Project invitations   | A project invites you, in the bell only: the email stays under Quest reminders. |
| Mentions              | Somebody writes your name in a quest or feedback comment.                       |
| Quest reminders       | Reminders about a quest you accepted, and project invitations.                  |

To stop one project's notifications rather than a kind, pause or stop the
subscription on that project's **Settings ▸ Notifications**.

Only you can change these: signed in, or with `lore notifications set` after
`lore login`. An API key or a connected app cannot.

## From an agent

An agent reaches a person through a comment that names them:
`quest_comment_add`, `feedback_comment_add`, or the `reason` of `quest_hold`.
Use it when you need that person, not to address the room. `inbox_list` and
`inbox_read` read and clear the inbox of the account the agent works as.

For project events, `event_catalog` lists them with their fields,
`event_list` reads the recent ones, and `subscription_list` and
`subscription_set` say and change who is notified of what. `channel_update`
renames a channel and `channel_delete` removes one, `threshold_get` and
`threshold_set` read and change the thresholds, and `quest_reminder_set` sets
your reminder on a quest. See [MCP tools](/lore/docs/reference-mcp-tools).

## From the command line

Everything on this page has a command: `lore event`, `lore subscription`,
`lore channel`, `lore threshold`, `lore quest reminder set`, `lore inbox` and
`lore notifications get`. A channel's URL is read from stdin, never typed on
the command line:

```bash
echo "$WEBHOOK_URL" | lore channel add --kind webhook --name ci-alerts --url-stdin
lore channel add --kind chat --room <room-id>
```

A webhook's signing secret is printed once, by `lore channel add` and `lore
channel rotate`. A channel's URL and secret never go through an agent's tool,
so a credential stays out of a model's context. `lore notifications get` and
`lore notifications set` read and change your own preferences, with the
account `lore login` signed in; an API key is refused. See
[CLI](/lore/docs/reference-cli).

## Next

- [Members](/lore/docs/project-members): invitations and who is in a project.
- [Feedback](/lore/docs/plan-feedback): the reports and answers behind
  several of these messages.
- [Healthchecks](/lore/docs/ship-healthchecks): monitors, and their bell.
- [Hosts](/lore/docs/project-hosts): hosts, and their bell.
