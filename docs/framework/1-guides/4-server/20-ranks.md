# Ranks

`alepha/api/ranks` answers what somebody may do **inside one scope**: a
project, a club, a workspace.

A role cannot answer that. Roles are application-scope - the same person is
`user` everywhere - and the question "may Ada edit this project's releases?"
has a different answer per project for the same Ada. A rank is the permission
set she holds in one of them.

```typescript check
import { AlephaApiRanks } from "alepha/api/ranks";
```

## The one rule: narrowing, never widening

Effective access is **application permission AND rank permission**. The two
registries stay separate on purpose: merging them would let the owner of one
scope grant themselves `admin:*`.

Registering the module IS the substitution. `$owns({ requires })` asks
`ResourceGrantsProvider`, whose default allows everything, and this module
replaces it with the one that reads a rank. An application that never
registers the module keeps today's behaviour exactly, whether or not its call
sites name a permission.

## ⚠️ It never owns the assignment

There is no `(userId, scopeId, rank)` table here, and adding one would make
every authenticated request in every consuming application pay a read forever.

The assignment is a **column on a row the application already loads** - the
membership row `$owns` reads to decide the gate - and `$rankResource.rank` is
**synchronous** precisely so there is nowhere to put a query.

## Declaring a scope

One `$rankResource` per kind of scope. It tells the module what a scope is,
where the assignment lives, which ranks exist by default and who may edit
them.

```typescript
import { $rankResource } from "alepha/api/ranks";

class ProjectRanks {
  project = $rankResource({
    type: "project",

    // The row `$owns` decided against, recognised by its shape rather than by
    // a param - with a `through` gate the param names a quest, and only the
    // authority row is the project.
    scope: ({ authority }) =>
      typeof authority?.id === "number" ? String(authority.id) : undefined,

    // ⚠️ Synchronous, and a column read. This is the performance contract.
    rank: ({ membership }) => membership?.rank as string | undefined,

    builtins: [
      { key: "owner", name: "Owner", permissions: ["*"] },
      {
        key: "member",
        name: "Member",
        permissions: ["project:read", "quest:read"],
        // A DEFAULT rather than a rule: an administrator is expected to tune
        // it. See "Two kinds of built-in" below.
        configurable: true,
      },
    ],

    ownerOnly: ["project:delete"],
    floor: ["project:read"],
    manage: "rank:manage",
  });
}
```

## The floor and the ceiling

Two lists, and both are data rather than special-cased strings.

**`floor`** is what every rank holds whether or not its definition lists it. A
member whose rank cannot open the scope is a removal expressed badly, and
removal already says it properly. A definition that omits one is refused on
write, so the editor and the resolver cannot disagree about it.

**`ownerOnly`** is the ceiling: permissions **no rank may ever be granted**,
whatever the writer holds. For acts that belong to the scope's owner
structurally - deleting the scope, changing what it can do at all - where "an
administrator is trusted" is not the right answer, because the act widens
every rank at once including the actor's own.

## Two kinds of built-in

A built-in is **non-removable**. That is what makes it built-in, and it does
not change.

Whether it is **editable** is a separate question, and `configurable` is what
answers it:

- **off (the default)** for a rank that is a RULE. The `owner` whose `["*"]`
  is the whole point of it, or any rank the application will keep changing in
  code. A rewrite is refused rather than accepted and then silently reset from
  code on the next boot - which is the failure this rule exists to prevent,
  where an administrator's edits vanish with no explanation.
- **on** for a rank that is a STARTING POINT. A default `member`, whose set is
  exactly the thing an administrator will want to tune. Editing one writes a
  row that `ranksOf` already prefers over the declaration, so the edit
  survives a deploy.

⚠️ `Rank.editable` is therefore **not** the negation of `Rank.builtin`. A
configurable built-in is both, and an editor deriving one from the other would
offer no way to edit that rank with nothing on screen to say why.

## Ownership is transferred, never assigned

`assignRank` refuses a rank whose key the application treats as ownership, and
that refusal is the design rather than a missing feature: **a rank you can be
GIVEN is not ownership**. Transferring demotes the person performing it, which
no assignment does.

An application writes that act itself, and there is one property to get right.
If the database has no transactions - Cloudflare D1 does not - then "demote
then promote" can leave the scope with **no** owner and "promote then demote"
with **two**. The swap has to be one statement:

```sql
UPDATE members
SET rank = CASE WHEN user_id = ? THEN 'owner' ELSE ? END
WHERE project_id = ? AND user_id IN (?, ?)
RETURNING user_id
```

## The invariants on the write path

Every one of them lives in `RankService`, because an editor is one client and
this is the write path.

- **Never `admin:*`.** Instance-wide permissions are not a scope's to hand out.
- **Never the ceiling**, whatever the writer holds.
- **Never wider than the writer's own set.** Handing somebody a rank you could
  not have written is the same escalation by a different door, so the subset
  rule applies to assignment as well as to editing.
- **Never your own row.** The subset rule stops you handing somebody MORE than
  you hold; it cannot stop you handing yourself less, and a scope whose only
  manager has demoted themselves out of `manage` is locked with no way back.
- **Never a self-lockout**: dropping `manage` from your own rank is refused
  for the same reason.
- **Never delete a rank somebody holds.** Reassign first: falling back to some
  other rank would be a demotion (or a promotion) nobody asked for, applied to
  people who are not in the room.

## Caching, and the half that must not be cached

- **Definitions** are cached, and memoized per request. What a rank grants
  changes rarely and is read on every gated call.
- **The assignment is never cached.** It rides the membership row, which the
  gate reads uncached precisely so a demotion or a removal takes effect on the
  **next request**. A window on revocation is the one property this module must
  not introduce.

⚠️ The per-request memo is not redundant with the TTL cache. The cache answers
the second REQUEST; it cannot answer the second ENTRY of a batch already in
flight, because all of them miss before any of them populates it. One page
navigation is often one batch of seven calls.

## Refusals name the fix

A refusal that says only what is missing leaves the reader - very often an
agent - with nowhere to go, and the answer is never "try again": somebody else
has to change the rank. The module's default names the permission and points
at whoever holds `manage`.

Effective access is a conjunction, and only the application knows which
conjunct failed. `refuse` is the seam for saying so: a scope where the feature
is switched off entirely has no row in its matrix to grant, and telling that
member to ask for a better rank is a closed loop.

```typescript
{
  refuse: async ({ scopeId, missing, rank }) => {
    // Return `undefined` to accept the module's own wording.
    return undefined;
  },
}
```

## The HTTP surface

The module ships the endpoints, so an application gets a rank editor without
writing a controller: the permission catalogue, the scope's ranks, save,
delete, and assign.

⚠️ They carry `$secure()` and nothing more. **Authentication is the module's
to require; authorization is the resource's**, through `assertCanManage` and
`assertCanAssign`. There is no permission string on the action for an
application to match, because who may edit ranks is a fact about the scope
rather than about this module.
