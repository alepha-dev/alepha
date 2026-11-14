# Capabilities

A project is a container: a name, an address, its members, and the parts of
Lore it uses. Those parts are its **capabilities**, and there are three, one
for each thing Lore does: **Plan**, **Remember** and **Ship**. A team that only
wants a wiki turns on Remember alone; a team that plans, documents and
operates a product turns on all three.

## The three capabilities

| Capability   | Sidebar entries                                | What it is for                                                 |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------- |
| **Plan**     | Quests, Epics, Releases, Feedback, Automations | The work: what is planned, in progress, shipped and asked for. |
| **Remember** | Folios                                         | The memory: linked notes, files and their history.             |
| **Ship**     | Apps, Errors, Stacks, Artifacts, Uptime        | What you run: deploys, analytics, errors and checks.           |

A capability is the pillar; the things inside it keep their own names. A quest
is still a quest and a deploy is still a deploy: Ship is where deploys live.

Some things belong to every project, whatever its capabilities: the
[dashboard](/lore/docs/project-dashboard), the activity feed,
[reports](/lore/docs/project-reports), [members and
ranks](/lore/docs/project-members) and
[notifications](/lore/docs/project-notifications). A project with every
capability off is still a project with members and a history.

## Options

Most capabilities have options, so that a small project is not shown a page it
will never use. An option that is off hides its menu entry and its fields.

**Plan**

A list of quests and a board are always there when Plan is on. See
[Quests](/lore/docs/plan-quests).

| Option            | What it adds                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **Epics**         | Bounded initiatives that group quests. See [Epics](/lore/docs/plan-epics).                                     |
| **Releases**      | Named versions that ship. See [Releases](/lore/docs/plan-releases).                                            |
| **Estimates**     | A planned duration on each quest.                                                                              |
| **Timer**         | The time a quest actually took.                                                                                |
| **Reminders**     | A nudge to whoever holds a quest that has gone quiet.                                                          |
| **Agent prompts** | A menu that copies a ready-made prompt for your coding agent. See [Agent prompts](/lore/docs/agents-prompts).  |
| **Feedback**      | A request form for your users and an inbox to triage what they send. See [Feedback](/lore/docs/plan-feedback). |

**Remember**

| Option                   | What it adds                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Summaries for agents** | Shows the summary field on a folio. See [Folios](/lore/docs/remember-folios). |

**Ship**

| Option           | What it adds                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| **Track apps**   | Analytics, vitals and errors reported by your apps. See [Telemetry](/lore/docs/ship-telemetry).               |
| **Deploy apps**  | Pushing a build to a machine you own. See [Deploying an app](/lore/docs/ship-deploying).                      |
| **Monitor apps** | Checks on websites, ports, certificates and scheduled jobs. See [Healthchecks](/lore/docs/ship-healthchecks). |
| **Stacks**       | Apps and services deployed together from one Compose file. See [Stacks](/lore/docs/ship-stacks).              |

## Turning one on or off

Open **Settings ▸ General ▸ Capabilities**. Each capability is a switch, with its
options beneath it.

![The Capabilities tab of a project's settings](/screenshots/lore/capabilities-light.png)

Turning a capability off:

- removes its entries from the sidebar and its results from search;
- refuses new writes to it, from the browser, the command line and agents
  alike, with a message that names the capability;
- **deletes nothing**. Turn it back on and every quest, folio or app is where
  you left it.

Only the project's **owner** can switch capabilities. No rank can be given
that right.

## The rest of a project's settings

**Settings ▸ General ▸ Details** holds the project itself:

- **Icon** and **Name**. Renaming a project changes its address, and frees the
  old one for someone else to take.
- **Preferred Language**: the language agents should write quests and folios
  in.
- **Repository**: where the project's commits live. Once it is set, the commits
  recorded on a quest become links.
- **Export quests** downloads every quest as a CSV file.
- **Archive project** hides it from the switcher, search and the home page
  without deleting anything.

⚠️ **Delete this project** removes the project and everything in it, for good.
Only the owner can do it.

Each capability then has its own settings section, named after it: **Plan**,
**Remember**, **Ship**.

## From the command line

```bash
lore project capability list -p acme
lore project capability enable ship -p acme --option uptime
lore project capability enable plan -p acme --option feedback
lore project capability disable remember -p acme
```

`enable` also changes the options of a capability that is already on; options
you do not name keep their value. See
[The lore CLI](/lore/docs/reference-cli).

## Next

- [Members and ranks](/lore/docs/project-members): who is in the project and
  what each person can do.
- [Dashboard](/lore/docs/project-dashboard): the page a project opens on.
- [Quests](/lore/docs/plan-quests): the heart of Plan.
