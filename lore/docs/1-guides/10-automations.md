# Automations

An automation is a saved, deterministic rule: when something happens, or a UTC
schedule is due, Lore selects authorized data, tests a condition and performs an
ordered list of actions. No AI runs inside it. An agent can help author a rule
through MCP, but execution uses the saved program and ordinary application code.

An owner first enables **Work > Automations** in project capabilities and assigns
the appropriate rank permissions. The option starts off. Enabling it does not
adopt existing reminder or release policies, and adoption never grants permissions
or enables capabilities for you.

## Start in the application

Open **Automations > New automation**. The seven stock presets cover new
feedback, a nightly tagged-quest digest, epic completion, coverage regression,
open-blight crossings, release publication to a folio, and failed deployments.
Only the presets this project's capabilities, your permissions and the configured
channels allow are offered.

Pick a preset, then fill its few inputs. Members, folios and apps are chosen
through pickers that search the project. Every input belongs to this rule alone
unless you choose **Share with other automations**, which binds or creates a
shared variable. **Create automation** saves the rule disabled and opens its
page. There, **Run test** shows its timestamp, source, counts and rendered
actions without writing anything; then **Enable** it from the page header. An
event test needs a same-project record chosen in the subject picker. A schedule
test reads its current selection.

Click a rule's row to open it. **Edit** changes its four slots; its run history
is listed below. Saving uses the revision you opened: a conflicting save keeps
your draft, so you can compare it with the current rule before choosing
**Discard draft and reload**. Disable or delete stops queued and following effects;
effects that already committed remain.

## The four slots

| Slot    | Meaning                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Trigger | One registered event, or a five-field UTC cron schedule.                                               |
| Select  | `null` for an event; one registered selector or numeric metric for a schedule.                         |
| Guard   | `null` to always match, or one typed comparison against an available source field.                     |
| Actions | One to five ordered operations: notify, append a folio, create a quest, assign a release or add a tag. |

There are three scheduled selection cardinalities:

| Selection    | Execution                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `rows`       | Test the guard and run the action list separately for each selected row.                                                   |
| `scalar`     | Read one numeric result and run the action list once if it matches. A measured zero is a value.                            |
| `collection` | Retain up to 50 rows and run the list once with the collection's deterministic summary. An empty collection sends nothing. |

An event supplies one context and requires `select: null`. A schedule requires a
selection. Fields and operators come from the catalogue for that source; a
progress object is not a numeric metric, and arbitrary queries or code are not
accepted. Deploy-failure rules may filter one validated app across environments.

## Example: record a release, then notify a member

The **release-to-folio** preset appends the publication's frozen changelog and
then enqueues an inbox or email message. It does not replace the existing release
announcement policy. Pick the folio and recipient in the application, or call
`automation_create` with a program like this:

```json
{
  "project_name": "Lore",
  "title": "Record published releases",
  "rule": {
    "version": 1,
    "trigger": { "kind": "event", "event": "release.published" },
    "select": null,
    "guard": null,
    "actions": [
      {
        "kind": "appendFolio",
        "folio": "11111111-1111-4111-8111-111111111111",
        "text": "## {{release_tag}}\n{{changelog}}\n\n{{quest_count}} quests. {{url}}"
      },
      {
        "kind": "notify",
        "recipient": "22222222-2222-4222-8222-222222222222",
        "channel": "inbox",
        "category": "releases",
        "title": "Release {{release_tag}} published",
        "text": "{{project}}: {{title}}. {{url}}"
      }
    ]
  }
}
```

The UUIDs are illustrative. Replace them with a real same-project folio and
member, and choose your actual project. A member binding is a user UUID, not an
email address. A folio is a UUID; a release binding is a positive numeric ID.

The response contains the new rule's `id` and `revision`. Test it with
`automation_test`, supplying `source: { "kind": "subject", "id": 12 }` where 12
is an actual release ID in the project. This is a prospective publication
preview, not a publication or an enqueue. Then call `automation_update` with the
rule ID, current `expectedRevision` and `enabled: true`. A later real publication
runs the program. Republishing after an explicit reopen is a new publication.

Actions commit in order. If the append succeeds but enqueue fails, the folio
stays appended and the run reports partial progress. A retry reconciles the
native receipt instead of appending the same publication again. It cannot undo
an earlier effect to make the run appear all-or-nothing.

## Literal, context and shared values

A literal belongs to one rule. `{{release_tag}}` is a declared field from that
rule's source. A shared value is an explicitly created project variable referred
to by its key, such as `{{release_log}}`. Resource and numeric bindings keep their
native types; prose may render them as text.

Shared kinds are `member`, `channel`, `folio`, `release`, `number` and `text`.
Choose **Shared variables** to create or edit one and inspect its used-by list.
Preset setup can use an existing variable or explicitly create one. It never
silently creates or overwrites a generic `recipient` variable. Setup retains the
selected variable's UUID and version, and refuses a concurrent change or key
replacement rather than silently binding a different value.

A shared edit revalidates the editor's own rules under their original execution
authority. Other authors' consumers pause for their review. Their original
author must inspect the change and explicitly enable the rule again. Predicate
or scope changes reset a crossing baseline; changing only prose, recipients or
cadence preserves it. Delete is refused while a variable is used. Updates and
deletes require both its immutable `id` and current `version`.

Templates have no scripts, expressions or arbitrary object traversal. Only
catalogue-declared fields and explicitly shared keys resolve. A resolved value
is data: text containing another `{{placeholder}}` is never interpreted a second
time. HTML output is escaped, custom prose is preserved and stock messages are
English. Unknown fields, incompatible types and unavailable resources refuse.

## Whose authority executes

The author is immutable. Each run and each effect rechecks that person's current
account, membership, rank permissions, project capabilities and original
credential ceiling. API-key revocation, expiry or scope reduction stops the
rule. OAuth execution also checks its retained revocable grant and current
client/scope. A manager cannot lend their own authority to another author's rule.

`automation:read` allows permitted inspection, `automation:write` authors and
enables your own rules, and `automation:manage` manages shared variables and can
stop or delete another author's rule. Source and target permissions still apply.
Readers without current source access see redacted payload and receipt details.
Recipients must also retain access to the relevant source. Notification
preferences and suppression are checked at delivery time.

Enable intent and health are separate. **Broken** means a dependency such as a
capability or channel is unavailable; restoring it can recover a still-enabled
rule after validation. **Paused** with required review follows authority loss,
foreign shared changes or an unknown effect. Restoring access alone does not
clear that review. Inspect the reason, fix it, Test again and explicitly enable
as the original author. Revision conflicts require a fresh read, not a blind
resend. Removing an author from the project pauses their rules.

Automation-generated effects do not become new automation source events, so
rules cannot chain into loops. Existing application validation, ordinary domain
behavior, audits and notifications remain in force.

## Scheduling and numeric conditions

Schedules use five-field cron in **UTC**, independent of the browser's timezone
or daylight-saving changes. Minutes must align with the fixed five-minute ticks;
`*/5 * * * *` and `0 0 * * *` are valid examples. The minimum cadence is five
minutes. Missed ticks coalesce to the latest due occurrence instead of replaying
every missed interval. A rule cannot overlap its own claimed occurrence.

A coverage regression compares exact line-coverage samples for the previous two
closed UTC days in the chosen branch, defaulting to `main`. The threshold is a
strict drop in percentage points. Missing either day is **no_data**, not zero,
and does not borrow another branch's or an older day's sample. Equality does
not alert.

A crossing guard first records a baseline without alerting. It alerts when a
value moves from at or below the threshold to above it, stays quiet while above,
and rearms after returning to or below it. Predicate or scope edits start a new
baseline. Test reads the decision without advancing that baseline.

## Bounds, evidence and recovery

| Boundary                     | Limit                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ordinary selection           | 50 retained rows. More rows are reported as capped or a lower bound, with `hasMore`; they are not silently fetched. |
| Program                      | Five ordered actions.                                                                                               |
| Delivery run                 | 100 recipient-channel attempts. Explicit compatibility rosters continue in further bounded runs.                    |
| Worker step                  | At most five ordered steps, or five compatibility-roster recipient attempts, before rescheduling.                   |
| Rendered action              | 16 KiB, including its final serialization/envelope. Truncation is visible.                                          |
| Frozen snapshot              | 64 KiB. A snapshot that cannot retain critical execution evidence refuses before effects.                           |
| Dispatcher                   | 50 claims shared across recovery, events and schedules per tick.                                                    |
| Detailed run evidence        | 30 days.                                                                                                            |
| Deduplication/replay horizon | 90 days. Expired source evidence refuses; it is not recreated from current data.                                    |

Only the explicitly adopted compatibility reminder selector continues beyond
its 50-row pages. Its original evaluation time and exact due-state identities
remain fixed. The tagged nightly digest and ordinary selectors keep their
ordinary bounds.

A notification action marked **queued**, with `enqueued: true`, proves an outbox
intent committed. It does not prove delivery. Run details show live receipts
separately: queued retries, email **sent** (transport acceptance), inbox
**delivered**, skipped, failed or unknown. Email acceptance is not confirmation
that the recipient opened or received it. An address or preference change can
cause a queued delivery to be skipped.

Native database effects commit with their durable receipts. An external effect
whose result is uncertain becomes **unknown**, stops later actions and requires
review. Check the destination before authorizing future work; an uncertain
external start is not blindly resent. A later failure preserves earlier effects
as a partial run. Already completed occurrences remain deduplicated after their
detailed run has expired. Test of retired evidence refuses; choose a new
prospective subject for a fresh read-only preview.

Configuration changes use sanitized audits under Lore's existing **finite**
audit-retention policy, as approved by the owner. This does not promise permanent
audit storage. It is separate from the 30-day detail and 90-day replay windows.

## Adopt existing reminders or release announcements

Per-quest reminders remain alongside the tagged nightly digest. They preserve
hourly processing of each quest's `reminderNextAt` and `reminderInterval`, email
to `acceptedBy`, `reminder_sent` history and the existing quest Settings controls.
The live option is `work.reminder`. Frozen `projects.features.questReminder`
storage remains readable; it is not the live switch.

Release compatibility notifies the current roster **except the publisher**
through inbox and email, under the releases category and existing preferences.
It requires no folio. Both channels are required. Its explicit roster audience
is distinct from the single-member release-to-folio preset above.

Open **Automations > Built-in notifications**:

1. The owner configures capabilities and rank grants separately.
2. The consenting named member previews author, grants, channels, recipients and
   preserved reminder state. Release preview assumes that member publishes;
   live execution excludes the actual publisher.
3. Choose a new compatibility rule or your own already configured compatible
   rule. Confirm **Consent and adopt**. Existing-rule adoption checks its current
   revision and does not create a duplicate.
4. If interrupted while pending, **Resume my adoption** reuses the prepared rule.
   A deleted pending draft can be replaced through renewed consent. The legacy
   policy stays eligible until validation and atomic cutover succeed.
5. After adoption, open the replacement to Test, inspect history or stop it.
   Disable or delete is an intentional opt-out. The independent marker remains,
   so legacy sending never returns. Repeating adoption does not reenable an
   opted-out rule. Only the original author can explicitly enable a disabled
   replacement again. A deleted replacement keeps the policy opted out.

There is no silent migration, system author or bulk grant/capability backfill.
Unadopted project policies retain their legacy implementation. Cutover atomically
chooses the eligible enqueue path; queued legacy messages check the marker again
at dispatch, including work queued before adoption. Full rosters and reminder
backlogs resume through durable bounded continuation.

Inbox and email are the required channels. Optional transports appear only when
a server adapter, compatible registered templates and actual configuration are
available. Naming `sms` or `discord` in a rule does not provision a destination.
Optional sink setup is deferred; unavailable transports explain why they cannot
be used. This guide does not require a Discord demo.

## MCP operations

Every operation takes `project` (numeric ID) or `project_name` (title or slug).
The numeric ID wins when both are supplied. Paged operations use `offset`
(default 0, at most 100000) and `limit` (default 20, from 1 to 50).

| Tool                             | Parameters beyond project selection                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automation_catalog`             | None. Discover authorized sources, native slots, operators, presets, channels, variables and limits first.                                        |
| `automation_create`              | `title`, complete `rule`, optional `enabled` (default false). Explicit true still creates disabled first, then validates enable.                  |
| `automation_list`                | Pagination; optional `search`, `state`, `authorUserId`.                                                                                           |
| `automation_get`                 | Automation `id`. Returns current revision, health and permitted controls.                                                                         |
| `automation_update`              | `id`, `expectedRevision`, and either `title` plus the complete `rule`, or `enabled` alone. These are separate calls.                              |
| `automation_delete`              | `id`, `expectedRevision`. Soft deletion retains permitted history.                                                                                |
| `automation_test`                | `id`, optional `source`. Events require a subject or retained evidence.                                                                           |
| `automation_runs`                | Automation `id`, pagination. Includes bounded immutable snapshots and separate live notification outcomes.                                        |
| `automation_variable_set`        | `key`, `variable: { value: { kind, value } }` for creation; include `variable.id` and `variable.version` for an edit.                             |
| `automation_variable_list`       | Pagination. Source-restricted values are redacted.                                                                                                |
| `automation_variable_dependents` | `key`, pagination. Inspect consumers before changing a shared value.                                                                              |
| `automation_variable_delete`     | `key`, variable `id`, `version`; only unused variables can be deleted.                                                                            |
| `automation_adoption_preview`    | `policy`: `quest-reminders` or `release-notifications`. No writes.                                                                                |
| `automation_adopt`               | `policy`, `confirm: true`; optionally your compatible `automationId` and `expectedRevision`. Resumes pending adoption and never reverses opt-out. |

A Test source is exactly one of:

```json
{ "kind": "subject", "id": 12 }
```

```json
{ "kind": "event", "id": "33333333-3333-4333-8333-333333333333" }
```

```json
{ "kind": "run", "id": "44444444-4444-4444-8444-444444444444" }
```

Subject IDs have the native type of the declared event's project resource.
Event/run UUIDs must identify retained, authorized evidence. These IDs are
illustrative, not caller-supplied payloads. Test never writes domain data,
audits, runs, queue rows, delivery receipts, health, cursors or baselines, even
when it refuses. After inspection, enable with the revision from a fresh read;
inspect `automation_runs` after a real source occurrence rather than treating a
successful Test as delivery.
