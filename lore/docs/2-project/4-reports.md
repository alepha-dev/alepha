# Reports

**Reports** is what happened in a project over a period, measured. The
[dashboard](/lore/docs/guides-project-dashboard) is a board you compose; Reports
is fixed, and every figure says what it counts behind an info mark.

Every project has Reports. Each tab appears with the capability behind it, so a
project with everything off still has Summary and Team. Reading a report needs
the **`stats:read`** permission.

## The tabs

| Tab           | Needs     | Answers                                                                     |
| ------------- | --------- | --------------------------------------------------------------------------- |
| **Summary**   | -         | Every capability's period against the one before, with a link to explain it |
| **Flow**      | Work      | How work moved: throughput, cycle and lead time, WIP, what is aging         |
| **Backlog**   | Work      | The open work as it stands: by area, tag, priority, size, age, blockers     |
| **Planning**  | Work      | Epics and releases: timeline, burn-up, scope change, forecast, slip         |
| **Support**   | Support   | Feedback from intake to shipped                                             |
| **Knowledge** | Knowledge | Folio activity, stale pages, orphans, the link graph                        |
| **Delivery**  | Apps      | The four DORA keys and reliability: blights, errors, uptime                 |
| **Quality**   | Apps      | Coverage and tests CI pushed, by branch, against a target, per release tag  |
| **Team**      | -         | Load and contribution per member, how work arrives, agents, automations     |

## The filter bar

The bar sits above every tab and lives in the URL, so a report can be linked and
moving between tabs keeps your filters. The default is the last 30 days.

- **Period** - 7, 30 or 90 days, 6 months, a year, all time, or a custom range.
- **Grain** - daily, weekly or monthly, picked from the period's length unless
  you choose. Weekly starts on Monday.
- **Compare to previous** - the same span just before, as deltas.
- **Area, epic, release, tag, priority, member** - narrow the quests.

A tab shows the filters it does not honour as disabled, rather than quietly
ignoring them. Team honours the period alone, because its activity data carries
no area or epic. A tag or a segment of a chart links to the quest list narrowed
the same way; that list has no period, epic, priority or member filter, so it can
show more than the chart counted. Sections with a table or a chart offer **CSV**.

## What the figures count

Every report reads the same quests: shelved quests are out, and so are the open
quests of a draft epic. A completed quest always counts, wherever it was filed.

| Figure                 | Counts                                                 | Divides by or notes                                                                   |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Throughput**         | Quests completed in the period                         |                                                                                       |
| **Cycle time**         | Median time from accepted to completed                 | Hold time is taken out                                                                |
| **Lead time**          | Median time from created to completed                  | Hold time stays: the requester waited                                                 |
| **WIP**                | Quests accepted and not completed, now                 | Held quests are left out                                                              |
| **Net growth**         | Created minus completed                                |                                                                                       |
| **Waived**             | Objectives waived                                      | Objectives decided, on completed quests                                               |
| **Progress**           | Quests done                                            | Total, with shelved quests left out                                                   |
| **Scope change**       | Quests added or cut after the epic started             | What it started with                                                                  |
| **Triage time**        | Median time from received to accepted or rejected      | Reports received in the period                                                        |
| **Conversion**         | Accepted reports whose quests are all completed        | Accepted reports                                                                      |
| **Deploy frequency**   | Successful deploys per week                            |                                                                                       |
| **Lead time (deploy)** | Median time from a quest completed to its first deploy | Matched by release tag or commit                                                      |
| **Change failure**     | Failed deploys and rollbacks                           | Finished deploys. A rollback is inferred: a deploy back to a tag the copy already ran |
| **Time to restore**    | Median time from an incident starting to it ending     | From monitors                                                                         |
| **Uptime**             | Monitor time outside an incident                       | The period                                                                            |

A median and a p85 go together: half the work took less than the first, and
85% less than the second, so one slow quest moves neither much.

**A quest counts under each of its tags,** so tag rows overlap and do not add up
to the project.

**Past states are rebuilt.** The cumulative flow reads timestamps and quest
history for days before snapshots began, and nightly snapshots after, which are
exact.

**The forecast is a simulation:** a Monte Carlo over the last twelve weeks of the
project's throughput, not of the release. Half the simulated futures finish by
the date shown.

## Team, and telling agents apart

Team shows what each member carries now (in progress, held, overdue) and what
they did in the period: quests created and completed, comments, folio edits,
feedback triaged, deploys. It is sorted by name or by load. **It never ranks
people by output:** the columns differ because the work does, and a triager or a
folio writer completes no quest and is not idle.

**An agent writes as the owner of its API key,** so the actor cannot tell the two
apart. Every recorded write also carries the channel it arrived on:

| Channel      | Is                                                            |
| ------------ | ------------------------------------------------------------- |
| `web`        | The browser                                                   |
| `mcp`        | An agent over MCP                                             |
| `cli`        | The `lore` CLI, recognised by its user agent, so a best guess |
| `api`        | Anything else with a token                                    |
| `automation` | An automation rule                                            |
| `system`     | Lore itself                                                   |
| `unknown`    | Written before channels were recorded                         |

**How work arrives** shows the writes per channel, and **Agents** in the member
table is the share of that member's writes that came over MCP.

The rest of the tab:

- **When work happens** - writes per weekday and hour in UTC, over the last 30
  days of the period at most, because older activity is kept per day.
- **Automations** - runs by outcome, success rate, duration, and broken rules.
  Run detail is kept 30 days.
- **MCP tools** - calls per tool that reached this project. A call refused before
  a permission check names no project, so a stranger's probing shows nowhere.
- **Explore** - the query builder over the project's activity and MCP calls, for
  the questions nobody anticipated.

Deploys and MCP calls per project are recorded from the release that added them,
so earlier periods read zero there.

## The weekly report

The **Weekly report** automation preset sends Summary's last seven days against
the seven before, every Monday at 08:00 UTC, to the member you pick, as an inbox
notification or an email. It starts disabled like every preset; see
[Automations](/lore/docs/guides-automations). A preset has one recipient, so
reaching several members takes one rule each. A recipient opts out by turning off
the automations category in their notification settings.

## For agents and scripts

`project_report` answers one section for the last N days, the figures as the tab
reads them, and `lore project report` is the same from a terminal:

```bash
lore project report summary --days 7
```

Sections are `summary`, `flow`, `backlog`, `planning`, `support`, `knowledge`,
`delivery`, `quality` and `team`. The **Write the weekly status** agent prompt on the Summary
tab builds on it; see [Agent prompts](/lore/docs/guides-agent-prompts).
