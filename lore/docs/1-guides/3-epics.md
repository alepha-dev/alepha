# Epics

An epic is a bounded initiative: it spans several areas, owns quests and
folios, and ends. It is not a category. An **area** is where work happens
(a module, permanent), a **release** is when something ships (a named goal
that holds epics and quests), and an epic is what is being built: it is
specified, it is worked, and it completes.

Its status is the permission on everything inside it. There are four. You
set the first two; the other two follow from the work.

## Draft, ready, in progress, completed

**Draft** is where an epic is specified. The quest set is being written:
quests are filed into the epic, moved in and out, reworded, shelved and
brought back, and the whole plan can be deleted. Nothing inside it can be
started. A draft epic's quests stay out of the project's backlog, the
kanban board and the reports, and the epic's own page is where you read
them.

**Ready** says the spec is done. The epic's quests join the backlog, where
anyone can pick them up, and the plan can still be edited: quests still move
in and out. An epic can go back from ready to draft as long as nobody has
started it.

**In progress** starts on its own, the moment the first quest of a ready
epic is accepted or assigned. From then on the quest set is frozen: its
quests are accepted, completed, shelved and unassigned, but no quest enters,
none leaves, and none is deleted.

**Completed** also happens on its own, when the last open quest of an epic
in progress is completed or shelved. It is final: nothing reopens. Neither
does a quest, in any epic: a completed quest is immutable, and follow-up
work is a new quest linked to the old one. The epic's own title and
description stay editable, because the record of what happened is meant to
be curated, and folios can still be filed under it. An outcome note written
after the work shipped belongs exactly there.

So the epic page offers two moves, and only while nobody has started: **Mark
as ready** on a draft epic, **Back to draft** on a ready one. Mark as
ready asks first, because it changes what everyone else sees in the backlog
and the first accept after it freezes the plan. An epic that has started
offers nothing, since its remaining move happens when its work is done.

## The predecessor gate

**An epic cannot start while the epic it depends on is not completed.** An
epic may name one predecessor. The roadmap draws the order ("After Epic 7").
You can still mark the dependent epic ready, which lets you specify a whole
chain at once; what waits is its first quest. Accepting it is refused until
the predecessor completes, and the epic page says "Blocked by Epic 7" in the
meantime. Over the API the refusal reads

> Cannot accept quest #Q412: Epic #E22 depends on Epic #E20, which is not
> completed.

Record a predecessor only when the epic genuinely cannot start before the
other one ends. An epic that overlaps its neighbour records nothing.

## Completing an epic

There is nothing to click. An epic completes when every quest in it is
completed or shelved. Shelving is the epic's equivalent of waiving an
objective on a quest: it records that the work was specified and declined.
An accepted quest that will not be done is unassigned first, then shelved.

A ready epic never completes this way, even if all its quests get shelved:
nothing in it was worked, and its plan is still open for a quest that will
be.

## You forgot something

The plan is frozen once the epic is in progress, on purpose: the plan as
committed stays readable, and an amendment gets its own name and its own
dates. Three routes, depending on what was forgotten.

- **It belongs to a quest already in the plan.** Add an objective to that
  quest. Objectives are the small-discovery valve, and nothing refuses them.
- **It is genuinely new work.** Open a new epic that depends on this one.
  Feature, then Feature V2. The predecessor gate keeps the order honest.
- **It turned out to be unnecessary.** Shelve the quest. The plan keeps the
  record that it was specified and declined; deleting it would not.

Trying to add a quest to an epic in progress is refused with both routes
named:

> Cannot add a quest: Epic #E30 is in progress. Its plan is frozen. File this
> in a new epic, or add an objective to a quest already in it.

## From an agent

Over MCP the same rules apply, and every refusal is a plain message that
names the epic, so an agent knows what happened.

- `epic_create` opens an epic in the draft status.
- `quest_create` with `epic_number` files quests into it, while it is
  draft or ready. With `accept: true` into a draft epic, the quest is
  created and the accept is refused as not ready, reported in the result
  rather than as an error.
- `epic_set_status` takes `ready` or `draft`, and nothing else. Deciding
  that a spec is done is the owner's call, so an agent refused because an
  epic is a draft should say so rather than mark it ready itself.
- `quest_accept` and `quest_complete` work the quests. The first accept of a
  ready epic starts it; under a draft epic they answer that it is not
  ready for development yet; under a completed one, "File this in a new
  epic".
- There is no call to complete an epic: it completes with the request that
  resolves its last open quest.

`quest_list` hides a draft epic's quests by default, exactly as the
backlog does, so that a list of quests is the list of quests that can be
accepted. Pass the epic's id as `epic` to read one epic's quests whatever
its status, or `includeDrafts: true` to see everything.

Going the other way, an epic can hand ITSELF to an agent: **Review** asks
one to sharpen the plan while it is still open (draft or ready), and
**Work on it** hands the whole epic over, quest by quest, once it is ready.
Both are in the epic's Agent Prompts menu, which is off until a project
turns it on. See [Agent prompts](/lore/docs/guides-agent-prompts).

## What the roadmap shows

The roadmap lists open releases and the epics inside them, sorted so that a
predecessor sits above what depends on it, with an "After Epic N" chip on
the dependent. An epic is shown with its status, so an empty progress bar on
a draft or ready epic reads as "not started" rather than "stalled". The
roadmap draws order; it does not say whether the gate currently blocks,
because that needs the predecessor's status and the roadmap may be public.
The epic's own page says "Blocked by Epic N" while it does.
