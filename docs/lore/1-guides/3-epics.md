# Epics

An epic is a bounded initiative: it spans several areas, owns quests and
folios, and ends. It is not a category. An **area** is where work happens
(a module, permanent), a **release** is when something ships (a named goal
that holds epics and quests), and an epic is what is being built: it starts,
it is worked, and it concludes.

Its status is the permission on everything inside it. There are three,
and they run one way.

## Plan, work, done

**Planned** is the spec phase. The quest set is being written: quests are
filed into the epic, moved in and out, reworded, shelved and brought back,
and the whole plan can be deleted. Nothing inside it can be started. A
planned epic's quests are specified but not released: they stay out of the
project's backlog, the kanban board and the reports, and the epic's own page
is where you read them.

**Active** is the dev phase. Beginning the epic releases its quests into the
backlog and freezes the quest set. Its quests can be accepted, completed,
shelved and unassigned. No quest enters, none leaves, and none is deleted.

**Done** is the record. Concluding is final: the epic cannot be reopened or
returned to planning, and no quest inside it can be reopened either. The
epic's own title and description stay editable, because the record of what
happened is meant to be curated, and folios can still be filed under it. An
outcome note written after the work shipped belongs exactly there.

The two transitions are the only verbs the epic page offers. **Begin** on a
planned epic, **Conclude** on an active one, and nothing on a concluded one.
Both ask first: Begin because it changes what everyone else sees in the
backlog, Conclude because it cannot be undone.

## The two gates

**An epic cannot begin while the epic it depends on is not done.** An epic
may name one predecessor. The roadmap draws the order ("After Epic 7"), and
Begin is refused until that predecessor concludes: the button is disabled
and says which epic blocks it, and over the API the refusal reads

> Cannot begin Epic #E22: it depends on Epic #E20, which is not concluded.

Record a predecessor only when the epic genuinely cannot start before the
other one ends. An epic that overlaps its neighbour records nothing.

**An epic cannot conclude while a quest is unresolved.** Every quest must be
completed or shelved first, or a terminal "done" would strand the open one
forever, since accepting a quest needs an active epic and the epic can never
be active again. The refusal carries the count:

> Cannot conclude Epic #E30: 3 quests are still open. Complete or shelve each
> one.

Shelving is the epic's equivalent of waiving an objective on a quest: it
records that the work was specified and declined. An accepted quest that
will not be done is unassigned first, then shelved.

## You forgot something

The plan is frozen once the epic has begun, on purpose: the plan as
committed stays readable, and an amendment gets its own name and its own
dates. Three routes, depending on what was forgotten.

- **It belongs to a quest already in the plan.** Add an objective to that
  quest. Objectives are the small-discovery valve, and nothing refuses them.
- **It is genuinely new work.** Open a new epic that depends on this one.
  Feature, then Feature V2. The predecessor gate keeps the order honest.
- **It turned out to be unnecessary.** Shelve the quest. The plan keeps the
  record that it was specified and declined; deleting it would not.

Trying to add a quest to an active epic is refused with both routes named:

> Cannot add a quest: Epic #E30 is active. Its plan is frozen. File this in a
> new epic, or add an objective to a quest already in it.

## From an agent

Over MCP the same rules apply, and every refusal is a plain message that
names the epic and the fix, so an agent knows what to do next.

- `epic_create` opens an epic in the planned phase.
- `quest_create` with `epic_number` files quests into it, while it is
  planned. With `accept: true` the quest is created and the accept is
  refused with "Begin it first", reported in the result rather than as an
  error.
- `epic_set_status` to `active` begins it, once its predecessor, if any, is
  done.
- `quest_accept` and `quest_complete` work the quests. Under a planned epic
  they answer "Begin it first"; under a concluded one, "File this in a new
  epic".
- `epic_set_status` to `done` concludes it, once every quest is completed or
  shelved. Asking for the status an epic already has is a no-op.

`quest_list` hides a planned epic's quests by default, exactly as the
backlog does, so that a list of quests is the list of quests that can be
accepted. Pass the epic's id as `epic` to read one epic's quests whatever
its phase, or `includePlanned: true` to see everything.

Going the other way, an epic can hand ITSELF to an agent: **Review** asks
one to sharpen the plan while it is still open, and **Activate** hands the
whole epic over, quest by quest. Both are in the epic's Agent Prompts menu,
which is off until a project turns it on. See
[Agent prompts](/lore/docs/guides-agent-prompts).

## What the roadmap shows

The roadmap lists open releases and the epics inside them, sorted so that a
predecessor sits above what depends on it, with an "After Epic N" chip on
the dependent. A planned epic is shown with its status, so an empty progress
bar reads as "not begun" rather than "stalled". The roadmap draws order; it
does not say whether the gate currently blocks, because that needs the
predecessor's status and the roadmap may be public. The epic's own page
says "Blocked by Epic N" while it does.
