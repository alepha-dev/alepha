# Releases

A **release** is a named goal that holds the work due to ship in it: `0.28.0`,
`demo-1`, `v1.0.0-rc.1`. An **area** is where work happens (a module,
permanent), an **epic** is what is being built (it starts and it completes),
and a release is when something ships.

Membership is an **assignment, not a time window**. Nothing is in a release
because it happened to be finished while the release was open: an epic or a
quest is in `0.28.0` because somebody put it there.

## Several are open at once

That is the normal state, not a warning sign. `0.28.0`, `1.0.0` and `1.1.0`
coexist, and a hotfix is a new release created beside the one it patches
rather than a state on it. There is deliberately no "one open at a time"
rule, and nothing about a release pauses.

A release has exactly **two** states, and it derives them rather than storing
them. It is **open** while it has no release date, and **released** once it
has one.

## Publishing is a one-way door

Publishing stamps the date, renders the changelog and **freezes** the four
progress counts onto the release. From that moment it renders entirely from
its own record: completing a quest a month later cannot rewrite what `0.28.0`
shipped. Nothing can be attached to a published release or detached from one.

**Reopening** is the single deliberate way back, for a release published by
mistake. It clears everything publishing froze, and the release goes back to
being computed from what it contains.

## What is in a release

Two things can be attached to one: **epics** and **quests**.

A quest can name a release directly, or inherit one from its epic. Those two
are not the same, and the difference matters:

- A quest that names **no** release, inside an epic that ships in `1.0.0`, is
  in `1.0.0`. The blank is what lets it follow its epic.
- A quest that names `0.28.0`, inside that same epic, is in `0.28.0`. An
  explicit attachment overrides its epic's, and that is a real state rather
  than an error: a piece of a larger initiative can genuinely ship early.

When an epic gains a release, that release is written down onto every quest of
it that named none. The ones that named their own keep it.

## The default release

A project may name **one** open release as its **default**: where a finished
quest lands when nobody said where it should go.

It is a **fallback, not a plan**. Everything can still be filed by hand, a
hotfix still is, and a project with no default at all is a perfectly normal
project. Creating a release never makes it the default, and nothing ever picks
a default for a project that has none: starting one is always an explicit act.

### What it catches, and what it leaves alone

When a quest is completed:

- if it **names a release**, nothing happens;
- if it **inherits one** from its epic, nothing happens;
- otherwise, if the project has a default and that default is still open, the
  quest lands in it, and the move is recorded in the quest's own Discussion so
  it is never a silent one.

The middle rule is the one worth knowing. A quest with no release of its own
inside an epic that ships in `1.0.0` is already in `1.0.0`; stamping the
default onto it would quietly move it out, dropping a line from that release's
changelog and a unit from its progress bar.

### Starting an epic

An epic that names no release takes the default **when it starts**, which is
the moment its first quest is accepted, and carries that release down to
every quest of it that named none. A quest that was given its own release
while the epic was still a draft keeps it.

Starting is deliberately the moment, rather than completing: where an epic
ships is a question answered when work begins, and an epic that only learned
its release at the end would find its quests already scattered across
whatever was default while they were being closed. Marking an epic ready does
not attach anything: nothing has started yet.

An epic started before the project had a default never gets one. Its quests then
land in the default individually as they complete, and show on that release as
loose work while the epic itself is in none. That is honest, and it is fixed
by attaching the epic to a release by hand.

### Publishing hands it on

Publishing the default release stops it being the default, because nothing can
be attached to a published release: leaving intake pointed at one would mean
the next finished quest could not be closed at all.

The default then moves to the release **next in line**: the lowest open release
above the one you published whose patch is `0`. In practice that is the next
minor, or the next major once no minor is left:

| Open when `0.29.0` (the default) is published | The new default |
| --------------------------------------------- | --------------- |
| `0.30.0`, `1.0.0`                             | `0.30.0`        |
| `1.0.0`                                       | `1.0.0`         |
| `0.29.1`, `1.0.0`                             | `1.0.0`         |
| `0.27.0`, `demo-2`                            | none            |

It never picks a patch or a prerelease (`1.0.0-rc.1`): a hotfix is filed by
hand, and catching loose work into it would put unrelated quests in its
changelog. It never moves backwards to an older release left open, and never
picks a tag that is not a version. When nothing qualifies, the project is left
with no default. The move is recorded in the new default's activity, naming the
release it came from.

Publishing any **other** release leaves the default where it is, and a project
with no default keeps none.

Reopening does **not** restore it. Reopening says the record was wrong, not
that intake should resume there.

## Over MCP

`release_list` and `release_get` report `defaultSince` on the release that
carries it, and `project_context` marks it in `openReleases`.
`release_set_default` moves it, naming the release by its tag; **omitting the
tag clears it**. `quest_complete`'s result carries `release` when, and only
when, the default caught that quest.
