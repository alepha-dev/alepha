# The project dashboard

Every project has a **Dashboard**, and it is what you land on when you open the
project. This page calls it the board; it is not the **Kanban** page of
[Quests](/lore/docs/guides-quests). It holds cards: each one is a number, and
each number is a link to the page it came from.

## The board belongs to the project, not to you

This is the first thing to know, because it is the thing people are surprised
by. There is one board per project and everybody in the project sees the same
one. Add a card and it appears for your colleagues; remove one and it goes for
them too.

That is deliberate. A private board about a shared project is a preference
rather than a view of the project, and "look at the dashboard" has to mean
something between two people.

**There is no personal layout.** If two of you want different cards, the board
holds both, or the project holds a second dashboard.

## Several dashboards

A project can hold several dashboards: one for the work, one for the apps, one
for a release. The selector on the left of the dashboard header names the one
you are looking at and lists the others; pick one to open it.

Each dashboard has its own link. The first one is the project itself
(`/acme`), and every other is under it by name (`/acme/dashboards/apps`), so a
link you paste to a colleague opens the same dashboard for them. Renaming a
dashboard changes its link, and the old one stops working.

From the same menu, **New dashboard** creates one after the last, **Rename
dashboard** renames the one on screen, and **Delete dashboard** deletes it with
its cards, for everyone. The last dashboard cannot be deleted. The order is the
order they were created in: the first one stays the page the project opens on
until it is deleted, and the next then takes its place.

The first dashboard nobody named shows as **Dashboard**, in each reader's own
language.

## The first dashboard is computed until you customize it

The first dashboard of a project with no card of its own is **computed**: Lore
builds it on every load from what the project does, its capabilities and its
data, and writes nothing. What needs you, your own work, the flow of quests,
the plan, the apps and the folios each get a place when there is something to
show, and a tile with nothing to say stays out. A project with no recorded
write in 90 days shows one line saying since when it has been quiet, under the
header, and what it shipped last.

A computed board is read-only for everyone. To change it, use **Customize**:
it copies the tiles you see into cards of the dashboard's own, once, and from
then on the dashboard is yours to edit. **Add card** on a customized dashboard
adds one: pick a metric and point it at the thing you care about.

**Only the first dashboard is computed.** Any other dashboard opens empty, and
you fill it with **Add card**.

## Who may change it

Editing the board needs the **`project:update`** permission.

In the ranks a project is created with, that means the **owner** and anyone
with the **Admin** rank. A **Contributor** or a **Viewer** reads the board and
cannot change it: no Add button, no card menu, no dragging.

The same permission creates, renames and deletes dashboards. A member without
it sees every dashboard in the selector and none of those entries.

If you want Contributors curating the board in your project, tick
`project:update` for that rank in **Settings ▸ Members ▸ Ranks**. It is a checkbox in
your own rank matrix rather than something Lore decides for you.

## The cards

Which cards you can add depends on the project's capabilities and your
permissions, and most take a scope: a project, an epic, a release, a tag or an
app. Flow cards read the same figures as [Reports](/lore/docs/guides-reports) and
link to the tab that explains them.

**The project**

| Card          | What it shows                                                   |
| ------------- | --------------------------------------------------------------- |
| **Needs you** | Held, stale and overdue work, crashes and feedback, in one list |
| **Activity**  | The project's last recorded writes                              |
| **Momentum**  | Recorded writes per day, as bars                                |
| **Note**      | Markdown you write, for everyone who reads the board            |

**Quests**

| Card                 | What it shows                                      |
| -------------------- | -------------------------------------------------- |
| **Active quests**    | Open quests in the project: to do plus in progress |
| **On hold**          | How many of those are parked, waiting on something |
| **Epic progress**    | How far one epic has got                           |
| **Release progress** | How far one release has got                        |
| **Tag completion**   | Completed over total for one quest tag             |
| **Your quests**      | What the reader has accepted and not finished      |
| **Reminders due**    | Your reminders in the next seven days              |
| **Due soon**         | Open quests due in the next seven days             |
| **Recently shipped** | The last completions, with their message           |

**Flow**

| Card                    | What it shows                           |
| ----------------------- | --------------------------------------- |
| **Burn-up**             | Created against completed, cumulative   |
| **Completed per week**  | The last eight weeks, as bars           |
| **Completed this week** | Against the week before                 |
| **Cycle time**          | Median hours from accepted to completed |
| **Quests by area**      | By area, tag or priority                |
| **Board**               | Open quests per kanban column           |

**Planning**

| Card                 | What it shows                                         |
| -------------------- | ----------------------------------------------------- |
| **Release**          | The release this project is heading for, and its pace |
| **Ready to publish** | Open releases whose every quest is done               |
| **Epics in flight**  | Epics in progress, with their bar                     |
| **Draft epics**      | Epics still being specified                           |

**Folios**

| Card                    | What it shows                                  |
| ----------------------- | ---------------------------------------------- |
| **Pinned**              | The first pinned folio, its summary            |
| **Recently edited**     | The last folios edited, by whom and when       |
| **New folios**          | Folios created in the window                   |
| **Folios by directory** | How many folios each top-level directory holds |

**Apps and feedback**

| Card                   | What it shows                                              |
| ---------------------- | ---------------------------------------------------------- |
| **App health**         | One pill per copy: its last deploy, and whether it reports |
| **Errors**             | Occurrences per day, deployments as rules                  |
| **Coverage**           | Line coverage over the recorded runs                       |
| **Open blights**       | For the project or a list of apps                          |
| **Unique visitors**    | Per app, yesterday against the day before                  |
| **Untriaged feedback** | Reports waiting for triage                                 |

**On hold is a subset of Active quests.** Both count the same set of open
quests, so "Quests 12 / On hold 3" reads as three of the twelve being stuck.

**A quest carrying two tags counts in both.** So tag cards do not add up to the
project's quest count, and they are not meant to: a tag says what kind of work
something is, and a quest can be two kinds at once.

### ⚠️ What the two progress cards divide by

Both show **completed over total, with shelved quests excluded from the
total**. A quest you decided against leaves the numerator and the denominator
together, so an epic can reach 100% with declined work left in it.

**This differs from the tick bar on the Epics list**, which draws all four
buckets - done, in progress, open and shelved - over the full total. So the
same epic can read 8 of 10 on its card and show ten ticks on the list, and
neither is wrong. The card says what it divided by, under the number.

### A card can point at something that is finished

An epic that has completed, or a release that has been published, keeps its
card. Both are done by definition, so the number is settled rather than stale,
and the card says which. To point it somewhere else, use **Change scope** in
the card's menu.

## Reset to default

A customized first dashboard has **Reset to default** in its menu. It deletes
every card on it, for everyone, and the dashboard is computed again on the
next load. Lore asks before it does.

Reset exists on the first dashboard only, since it is the only one with a
default to return to. Another dashboard is emptied card by card, or deleted.

## Where Activity went

Activity used to be the project root. It is now at `/activity` and everything
about it is unchanged - the same feed, the same filters, the same sidebar
entry, one path down.
