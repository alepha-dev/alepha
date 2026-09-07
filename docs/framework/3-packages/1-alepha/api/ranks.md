# Alepha - Api Ranks

## Installation

Part of the `alepha` package. Import from `alepha/api/ranks`.

```bash
npm install alepha
```

## Overview

A rank: the permission set somebody holds inside one scope.

**Features:**

- Ranks declared in code, customised as rows, only when customised
- A permission set that narrows an application permission and never widens it
- The assignment as a column on a row the request already reads: zero queries
- Definitions cached and disclosed, assignments never cached, so revocation is instant
- Invariants on the write path: no self-escalation, no self-lockout, never `admin:*`
- An HTTP surface for the editor, gated by the application's own closures

Roles say what kind of user somebody is, across the whole application. That
cannot answer what a member may do inside ONE project, club or workspace,
because the answer differs per scope for the same person. A rank does.

The module knows nothing about the scope. Declare one `$rankResource` per
kind to tell it what a scope is, where the assignment column lives, which
ranks exist by default and who may edit them.

## ⚠️ It never owns the assignment

There is no `(userId, scopeId, rank)` table here, and adding one would make
every authenticated request in every consuming application pay a read
forever. The assignment is a column on a row the application already loads,
and `$rankResource.rank` is synchronous precisely so there is nowhere to
put a query.

## Effective access

`application permission AND rank permission`, narrowing only. The two
registries stay separate: merging them would let the owner of one scope
grant themselves `admin:*`.

## API Reference

### Primitives

- [`$rankResource`](/docs/reference-primitives-$rankresource) - Teach the ranks module about one kind of scope.

### Providers

- [`RankGrantsProvider`](/docs/reference-providers-rankgrantsprovider) - The implementation of `alepha/security`'s grants seam, filled by this
- [`RankResourceProvider`](/docs/reference-providers-rankresourceprovider) - The registry of `$rankResource` declarations, keyed by type.
