# The project dashboard

Every project has a board, and it is what you land on when you open the
project. It holds cards: each one is a number, and each number is a link to
the page it came from.

## The board belongs to the project, not to you

This is the first thing to know, because it is the thing people are surprised
by. There is one board per project and everybody in the project sees the same
one. Add a card and it appears for your colleagues; remove one and it goes for
them too.

That is deliberate. A private board about a shared project is a preference
rather than a view of the project, and "look at the dashboard" has to mean
something between two people.

**There is no personal layout.** If two of you want different cards, the board
holds both. Ten tiles is not a crowd.

## It opens empty, and you fill it

A new project's board has nothing on it. That is not a bug, not a loading
state, and not a project that is misconfigured.

Nothing seeds it because the cards worth having need a target only you can
choose: an epic card needs an epic, a release card needs a release, a tag card
needs a tag. A board of two cards nobody picked is not better than a board of
none.

Use **Add card**, pick a metric, and point it at the thing you care about.

## Who may change it

Editing the board needs the **`project:update`** permission.

In the ranks a project is created with, that means the **owner** and anyone
with the **Admin** rank. A **Contributor** or a **Viewer** reads the board and
cannot change it: no Add button, no card menu, no dragging.

If you want Contributors curating the board in your project, tick
`project:update` for that rank in **Settings ▸ Ranks**. It is a checkbox in
your own rank matrix rather than something Lore decides for you.

## The cards

| Card                 | What it counts                                      |
| -------------------- | --------------------------------------------------- |
| **Active quests**    | Open quests in the project - to do plus in progress |
| **On hold**          | How many of those are parked, waiting on something  |
| **Epic progress**    | How far one epic has got                            |
| **Release progress** | How far one release has got                         |
| **Tag completion**   | Completed over total for one quest tag              |

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

## There is no Reset

Not on a project board and not on your own. A board this small has no layout
worth an undo, and on a shared one a Reset button is one person discarding
everybody's configuration in a click.

Remove cards one at a time. That is also how they got there.

## Where Activity went

Activity used to be the project root. It is now at `/activity` and everything
about it is unchanged - the same feed, the same filters, the same sidebar
entry, one path down.
