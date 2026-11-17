# Automations

An automation is a small graph, drawn on a canvas: one or more **sources**
that start it (something that happens in the project, or a schedule), then
**conditions** that choose a path, then **actions** that carry it out, such as
notifying a member, appending to a folio or creating a quest. An automation
does exactly what its graph says, every time. No AI runs inside it.

Every project has automations, whatever its capabilities, with no switch of
their own. What an automation can react to follows the project's capabilities
(see [Capabilities](/lore/docs/project-capabilities)): quest, epic, release and
feedback events need **Plan**, deploy, uptime and host events need **Ship**.
That grants nothing by itself. A rank also needs the **Automations**
permissions, which the owner and Admin hold by default (see
[Members](/lore/docs/project-members)):

| Permission                                                   | What it allows                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Read automations                                             | See the automations and their runs.                                      |
| Create and edit your own automations                         | Draw, test and enable automations of your own.                           |
| Manage shared variables and disable or delete any automation | Manage shared variables, and stop or delete another author's automation. |

## The automations page

**Automations** in the sidebar lists the project's automations: their name,
their author, what starts them, their state and their last run. **Trigger**
names the first two sources, then how many more, and says how many are
switched off.

![The Automations page, listing the project's automations and their state](/screenshots/lore/automations-light.png)

An automation is in one of four states:

| State        | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **Disabled** | Saved, and not running: a draft. Its page says so until it is enabled.                            |
| **Active**   | Enabled, and every source it runs on is healthy.                                                  |
| **Paused**   | Stopped until its author reviews it. See [Who an automation runs as](#who-an-automation-runs-as). |
| **Broken**   | Something every one of its sources needs is missing, such as a capability or a channel.           |

Click a row to open the automation. A row's menu enables, disables or deletes
it. The page's buttons open **New automation** and **Shared variables**.

## The canvas

An automation's page draws its graph. Each box is a node, and each wire says
what happens next:

| Node        | What it is                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| **Source**  | What starts a run: one event, such as **Host offline**, or a schedule. Its dot shows its own state.  |
| **Read**    | What a schedule reads: a list of records, or a number. Only a schedule is followed by a read.        |
| **Only if** | One comparison on a field. It leaves by **If true** or **If false**, and only that wire is followed. |
| **Then**    | One action. A notification shows its recipient and its channels.                                     |

![An automation with two sources on its canvas](/screenshots/lore/automation-canvas-light.png)

Drag the canvas to move around it, and use its buttons to zoom or fit it to
the screen. Click a node to read its whole configuration, message text and
placeholders included. On a phone the canvas is the same, read-only, fitted to
the width of the screen.

### Several sources

An automation can start from up to eight sources. A host bell, for instance,
makes one automation with four: the host's token invalid, its TTL passed, the
host offline and the host back online, each wired to its own notification.

- **Each source has its own switch.** Click a source and untick **Enabled** to
  stop that source alone: the others keep running. Disabling the automation
  stops all of them.
- **Each source has its own health.** When a source loses what it needs, such
  as Ship being turned off for a host event, that source is broken and says
  why, and the automation keeps running on the others. Only when every source
  is broken is the automation **Broken**.
- **A node sees the fields every source reaching it gives.** A notification
  reached from two different events can use only the fields both carry; the
  editor marks a field one source lacks and names that source. Give each source
  its own action when their fields differ.
- **A schedule is the only source of its automation.** A schedule and an event
  cannot share one: give each its own automation.

### What an action gives the actions after it

Some actions give the actions after them a value to use: **Create a quest**
gives `{{created_quest_id}}` and `{{created_quest_number}}`, **Append to a
folio** gives `{{appended_folio_id}}`. A later action can use it only when
every path to it passes the action that gives it. If that action did nothing,
such as a quest it did not need to create, the action that uses its value is
skipped and says why.

## Creating an automation

On **Automations**, click **New automation**. Lore offers the presets this
project's capabilities, your permissions and its notification channels allow,
each with a drawing of its graph.

1. Pick a preset and fill its few inputs. Members, folios and apps are chosen
   from pickers that search the project.
2. Click **Create and enable**. Lore checks your permissions and the inputs,
   saves the automation enabled, and opens its page. If a check fails, nothing
   is saved and the form says why.
3. Or click **Save as draft** to keep it **disabled**: on its page, click
   **Run test** to see what it would do, then **Enable** it.
4. Or click **Open in canvas** to draw on the preset before saving: add a
   second source, a condition or another action. Nothing is saved until you
   click **Save changes**, which creates it disabled and opens its page.

**Start from scratch**, beside the presets, opens an empty canvas.

The presets:

| Preset                               | What it does                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **New feedback**                     | Emails or notifies one member when feedback is created, with its description and a link to the report.        |
| **Nightly tagged quests**            | Sends one digest of the open quests carrying a chosen tag, at 00:00 UTC. An empty digest is skipped.          |
| **Weekly report**                    | Sends the Reports summary of the last seven days to one member, every Monday at 08:00 UTC.                    |
| **Epic completed**                   | Notifies one member when an epic in progress completes.                                                       |
| **Coverage regression**              | Compares line coverage over the two last full UTC days, and alerts when it dropped by more than a threshold.  |
| **Open errors cross a threshold**    | Samples the number of open errors every five minutes, and alerts when it rises above a threshold.             |
| **Publish release notes to a folio** | Appends a published release's changelog to a folio, then notifies one member. Each publication appends once.  |
| **Deployment failed**                | Notifies one member when a deployment of the chosen app fails, in any environment. Raw logs are left out.     |
| **Release published**                | Notifies one member when a release is published, with its tag, title, number of quests and a link.            |
| **Quest reminders**                  | Every hour, reminds each quest's assignee of a quest whose reminder is due, at the interval set on the quest. |
| **Monitor down**                     | Notifies one member when a monitor's outage is confirmed, with its address, the cause and the error.          |
| **Monitor recovered**                | Notifies one member when a monitor recovers from an outage, with how long it lasted.                          |
| **Host token invalid**               | Notifies one member when the nightly check finds a Cloudflare host's token no longer works.                   |
| **Host past its TTL**                | Notifies one member when a throwaway host passes its time to live. Lore stops and deletes nothing.            |
| **Host offline**                     | Notifies one member when a Bay host has stopped reporting for five minutes. A quick restart raises nothing.   |
| **Host back online**                 | Notifies one member when a Bay host reported offline reconnects.                                              |

Every input belongs to this automation alone unless you choose **Share with
other automations**, which uses or creates a [shared variable](#shared-variables).

### Subscribing with a bell

A page can also offer presets as a subscription of your own. Its bell creates
one automation that notifies you, on the channels you pick, with a source for
each event it covers, and deletes it when you turn the bell off. The
automation shows on the automations page like any other, and the bell's dialog
links to it with **Open in Automations**.

When a bell covers several events, its dialog lists them, each with a
checkbox: unticking one switches that source off, and the others keep
notifying you. If you disable the automation on its page, the bell reads as
off, and turning it on again replaces it.

| Bell                                                 | What it subscribes you to                             |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Above the [feedback inbox](/lore/docs/plan-feedback) | New feedback.                                         |
| On the **Releases** page                             | Every published release.                              |
| On an app's **Uptime** tab                           | That monitor going down and recovering.               |
| On **Apps**                                          | Any monitor of the project going down and recovering. |
| On a [host](/lore/docs/ship-hosts)'s console         | That host's token, TTL, going offline and returning.  |
| On **Settings** > **Hosts**                          | The same, for every host of the project.              |

A bell always notifies you, so it offers your own channels, In-app and Email.
To post to a Discord channel, add it to the automation on its canvas, or create
one from its preset.

### Testing an automation

**Run test** runs the saved automation against current data from one source,
and shows what it would select, which way each condition went, the path it
would walk and the exact messages it would send. Nothing is written, sent or
remembered, even when the test is refused. With several sources, choose the
one to start from in **Start from**, or select it on the canvas.

A source that is an event needs a **Source record** to test against: a
feedback item, a release, an epic of this project. The record does not change.
A schedule reads its current selection. A value an earlier action would give,
such as the number of a quest it would create, is known only when the run is
real: the test says so rather than inventing one.

A successful test is not a delivery. After enabling the automation, look at
its **Run history** once the real thing has happened.

## Editing an automation

On an automation's page, **Edit** turns the canvas into an editor.

![The canvas editor, a notification's settings open beside it](/screenshots/lore/automation-editor-light.png)

- **Add a node** lists what this automation may hold in this project, for you:
  sources, reads, conditions and actions. An entry you cannot add says why. The
  **+** beside a node's wire adds a node after it, already wired. **From a
  preset** adds a preset's source and steps to the automation.
- **Wire** two nodes by dragging from the right edge of one to the other. A
  wire the graph does not allow is refused while you drag, with the reason:
  nothing wires into a source, a read follows only a schedule, a condition
  never follows an action, a wire never closes a loop, and a source reaches at
  most five actions. **Wire to**, in a node's settings, does the same from the
  keyboard.
- **Configure** a node by clicking it: its settings open beside the canvas,
  with the placeholders it may use. A source's **Enabled** box is part of the
  draft there, saved with everything else.
- **Delete** a node or a wire by selecting it and pressing Delete, or from the
  node's settings. **Undo** and **Redo**, or Ctrl+Z and Ctrl+Shift+Z, step
  through the draft.

The graph is checked on every change: a node with a problem turns red and says
what is wrong, and **Save changes** waits until nothing is left. **Run test**
tests what is saved, so it reads **Save to test** while the draft has changes.

Saving applies to the version you opened. If the automation changed in the
meantime, the save is refused and your draft is kept, so you can compare
before choosing **Discard draft and reload**. Leaving the page with unsaved
changes asks first. Editing needs a wider screen than a phone's.

The events are new feedback, a release published, an epic completed, a quest
completed, a deployment failed or succeeded, a monitor down or recovered, and a
host's token invalid, its TTL passed, or the host offline or back online. The
actions are **Send a notification**, **Append to a folio**, **Create a quest**,
**Assign the quest to a release** and **Tag the quest**.

A schedule reads one of three things:

- **A list, one run each**, such as the open quests: the conditions are tested
  and the actions run separately for each row, up to 50.
- **A list as one digest**, such as the open quests with a tag: the actions run
  once, with up to 50 rows. An empty list sends nothing.
- **A number**, such as the count of open errors or a coverage percentage: the
  actions run once if the conditions lead to them. A measured zero is a value;
  a missing sample is "no data", and the automation does nothing.

Fields, comparisons and placeholders come from a fixed list for each source.
There are no free queries and no code.

**Disable** or **Delete** stops the automation's queued work and everything
after it. What it already did stays done.

### Messages and placeholders

A message can name fields of what started the run, in double braces:
`Release {{release_tag}} published`. The node's settings list the names
available. Only those names, the values earlier actions give, and your shared
variables resolve: an unknown name is refused, and a value that itself
contains `{{...}}` is never read a second time. There are no scripts or
expressions, and HTML in a value is escaped. Stock messages are in English,
and your own wording is sent as written.

### Schedules

A schedule is a five-field cron expression in **UTC**, whatever your browser's
timezone, with no daylight-saving shift. An automation runs every five minutes
at most, and its minutes have to fall on a multiple of five: `*/5 * * * *` and
`0 0 * * *` are valid. Runs missed during an outage are not replayed one by
one: the automation runs once, for the latest occurrence due. An automation
never overlaps itself.

### Thresholds and drops

**Rises above** alerts on a crossing, not on a level. The first reading only
records a baseline. The automation then alerts when the value goes from at or
below the threshold to above it, stays quiet while it remains above, and is
armed again once the value returns to the threshold or below. Changing the
condition or what is measured starts a new baseline; changing only the
message, the recipients or the schedule keeps it. A test never moves the
baseline. An automation holds at most one **rises above** condition.

**Coverage regression** compares the line-coverage samples of the two previous
full UTC days on the chosen branch (`main` unless you say otherwise). It alerts
only when the drop is strictly greater than the threshold, in percentage
points. If either day has no sample, the run reports no comparison data: it
does not read the day as zero, and does not borrow another branch's or an
older day's sample.

## Shared variables

A value typed into an automation belongs to it alone. A **shared variable** is
a named value several automations use, such as a recipient or a threshold, so
that changing it once changes them all. **Shared variables** on the
Automations page creates and edits them, and lists the automations using each
one. A variable holds a project
member, a channel, a folio, a release, a number or a text. Creating one while
setting up a preset never replaces an existing variable.

Changing a shared variable validates the automations you authored against the
new value. Those written by other authors **pause**: each author has to look at
the change and enable theirs again. A variable still in use cannot be deleted.

## Who an automation runs as

An automation runs as its author, with the author's permissions at the moment
it runs, and the author never changes. Before every run and every action, Lore
checks again that the author still has their account, their membership, the
rank permissions and the project capabilities the automation needs. One
created through an API key or an agent's connection also stops when that key
or connection is revoked, expires or loses the access it needs. Someone who
manages automations can stop or delete another author's automation, and cannot
edit it, enable it or lend it their own permissions.

The people an automation notifies must still have access to what it is about,
and their notification preferences are applied when the message is sent.
Someone who may read automations but not what its sources are about sees
"Source access unavailable" in place of its details.

When something an automation depends on goes away, its state says which case
it is:

- **Broken**: a capability or a channel every source needs is unavailable.
  When only some sources lose it, those sources are broken, each saying why,
  and the automation keeps running on the others. Bringing it back recovers
  them.
- **Paused**: the author lost a permission, was removed from the project,
  someone else changed a shared variable the automation uses, or an action
  ended with an unknown outcome. Restoring access is not enough. The author
  reads the reason, fixes it, tests again and enables the automation.

The author gets one message in their inbox, linking to the automation, when it
pauses or breaks, and not again while it stays that way. A check that could
not be made, because Lore could not read its own data for a moment, changes
nothing: the automation stays as it was and is checked again a few minutes
later.

What an automation does never triggers another automation, so automations
cannot chain into a loop. Everything else still applies to its actions: the
usual validation, history and notifications.

## Runs

An automation's page lists its **Run history**: each run, the source that
started it, and how it ended (succeeded, skipped, refused, failed, partially
completed or with an unknown outcome). **Source** filters the list to one
source's runs.

Opening a run paints its path on the graph as it was when it ran: what each
node did (**Ran**, **Skipped**, **Refused**, **Failed**, **Unknown** or **Not
reached**), which way each condition went, and the wires the run followed.
Below, each action's outcome and its deliveries.

![A run painted on its automation's graph](/screenshots/lore/automation-run-light.png)

Actions are carried out in order, and each one stays done. If the folio was
appended and the notification then failed, the folio stays appended and the
run is **Partially completed**. A retry does not append the same publication
twice, and nothing is rolled back to make a run look all-or-nothing.

A failed action stops the actions after it on its own path; actions on the
run's other paths still run. An action whose target is gone, such as a deleted
folio, is refused alone. An action whose result could not be confirmed is
**Unknown**: it stops the whole run and pauses the automation. Check the
destination yourself before enabling it again, since Lore does not resend
blindly.

A notification shown as **Queued** means the message was handed to delivery,
not that it arrived. The run shows the live receipts separately: an inbox
message is **Delivered** once it is in the inbox, and an email is **Sent** once
the mail service accepted it, which does not confirm it was received or
opened. A queued message can still be skipped if the recipient's address or
preferences change.

### Limits

| What                            | Limit                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sources in an automation        | Eight.                                                                                            |
| Nodes in an automation          | Forty.                                                                                            |
| Actions one source reaches      | Five, both ways out of a condition counted.                                                       |
| Channels of one notification    | Eight.                                                                                            |
| Rows a schedule reads           | 50. Beyond that the run says the selection was capped; the rest is not fetched.                   |
| One rendered message            | 16 KiB. A longer one is cut, and the run says so.                                                 |
| What a run records as its input | 64 KiB. A run that cannot record it is refused before any action.                                 |
| Deliveries in one run           | 100. A larger audience continues in further runs.                                                 |
| Run details                     | Kept 30 days.                                                                                     |
| Protection against repeats      | 90 days: an occurrence already handled is not handled again, even after its run details are gone. |

A run whose details have expired can no longer be tested against: choose a
current record instead. Edits to an automation are also written to the
project's audit history, which has its own limited retention, separate from
the two windows above.

## Channels

**Settings** > **Automations** > **Channels** lists where a project's automations can
deliver: **In-app** and **Email**, built in, then the Discord channels the
project adds, as many as it needs. Adding, renaming and deleting a channel takes
the permission to manage automations.

To add a Discord channel:

1. In Discord, open the channel's settings, then **Integrations** >
   **Webhooks**, create a webhook and copy its URL.
2. In Lore, click **Add a Discord channel**, give it a name such as `alerts`,
   and paste the URL.
3. Click **Save**. Lore posts a test message to the channel first, and saves
   nothing if Discord refuses it.

The URL is stored sealed and never shown again, in the app, the API, the CLI or
an agent's tools. To change it, open the channel's menu and choose **Rename or
replace URL**.

A notification names one or more channels. In-app and Email reach its
recipient, a member; a Discord channel is a room, nobody's in particular, so it
needs no recipient and gets one post per run. A post is cut to Discord's 2000
characters, and `@everyone` or a mention in a message pings no one.

Deleting a channel removes it from every automation that names it. Those keep
running on their other channels; one left with no channel at all is
**Broken**, since it can send nothing.

## What is an automation, and what stays personal

Nothing project-wide is sent without an automation. Release announcements, quest
reminders, uptime alerts, failed deployments, host alerts and new feedback are
all automations: a project with none sends none of them. A bell or a
preset is how one starts.

Messages addressed to one person stay outside automations, and reach them
whatever the project's automations: a mention, an answer to a report they filed, an
invitation, and the notice that one of their own automations was paused or
broke. See
[Notifications](/lore/docs/project-notifications).

**Quest reminders** runs hourly, follows each quest's own interval and next
date, emails the quest's holder and writes the reminder in the quest's history.
A project holds at most one, and it is the one automation not held to 50
rows: it works through every reminder due. It is created from any quest's
**Reminder** panel, with **Turn on reminders**, or from the preset here. Its channel is any of the
project's: In-app or Email reach the quest's holder, and a Discord channel gets
one post per quest due.

## From the command line

```bash
lore automation catalog
lore automation list
lore automation get <id>
lore automation create --title "Host alerts" --source host.offline --source host.online --action '{"type":"notify","config":{...}}'
lore automation source set <id> --node online --no-enabled --expected-revision 3
lore automation test <id> --node offline
lore automation runs <id> --source offline
```

See [The lore CLI](/lore/docs/reference-cli) for every command.

## From an agent

An agent can draw an automation for you, and the saved automation then runs
without it. It reads `automation_catalog` first (the node types, with their
ports and the values they give, the channels and the limits this project
allows), then calls `automation_create`.

The short form is `sources` and `actions`, every source wired to every action:

```json
{
  "project_name": "Acme",
  "title": "Hosts going away",
  "sources": [{ "type": "host.offline" }, { "type": "host.expired" }],
  "actions": [
    {
      "type": "notify",
      "config": {
        "recipient": "22222222-2222-4222-8222-222222222222",
        "channels": ["inbox", "email"],
        "category": "automations",
        "title": "{{host}} needs a look",
        "text": "{{project}}: {{host}}. {{url}}"
      }
    }
  ]
}
```

An action may then name only the fields every source has. For anything else,
such as a condition or one action per source, the agent writes the graph as
`nodes` and `edges`:

```json
{
  "project_name": "Acme",
  "title": "Record published releases",
  "nodes": [
    {
      "id": "published",
      "kind": "source",
      "type": "release.published",
      "config": {}
    },
    {
      "id": "record",
      "kind": "action",
      "type": "appendFolio",
      "config": {
        "folio": "11111111-1111-4111-8111-111111111111",
        "text": "## {{release_tag}}\n{{changelog}}\n\n{{quest_count}} quests. {{url}}"
      }
    },
    {
      "id": "tell",
      "kind": "action",
      "type": "notify",
      "config": {
        "recipient": "22222222-2222-4222-8222-222222222222",
        "channels": ["inbox"],
        "category": "releases",
        "title": "Release {{release_tag}} published",
        "text": "{{project}}: {{title}}. {{url}}"
      }
    }
  ],
  "edges": [
    { "from": "published", "port": "out", "to": "record" },
    { "from": "record", "port": "out", "to": "tell" }
  ]
}
```

The UUIDs stand for a folio and a member of the same project (a member is a
user id, not an email address). Nodes without a `position` are laid out by
Lore. The automation is created disabled, a draft; `"enabled": true` creates it
enabled in the same write, or refuses and creates nothing. `automation_test`
previews it from one source (`node`), with `source: { "kind": "subject", "id":
12 }` naming a release of the project; `automation_source_set` switches one
source; `automation_update` with the current `expectedRevision` and `enabled:
true` turns it on.

The full list is in [MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [Notifications](/lore/docs/project-notifications): where the messages land,
  and how a member turns them off.
- [Releases](/lore/docs/plan-releases): what a published release holds.
- [Folios](/lore/docs/remember-folios): where an automation can append.
- [Members](/lore/docs/project-members): who may write and manage automations.
