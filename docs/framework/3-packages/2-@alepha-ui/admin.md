# @alepha/ui - Admin

## Installation

```bash
npm install @alepha/ui
```

## Overview

The back office.

`AdminRouter` mounts a dashboard, users, sessions, API keys, jobs,
notifications, audits, files, parameters, payments and analytics, each page its
own lazy chunk, and each hidden when the server does not register its actions
or the admin does not hold its permission. `$pageAdmin` adds a page to the same
shell. The pages are exported by name too, for an app that routes them itself.

## API Reference

### Primitives

- [`$pageAdmin`](/docs/reference-primitives-$pageadmin) - `$pageNav` already parented to `AdminRouter`'s `/admin` shell: the

### React Hooks

- [`useConfirmedAction`](/docs/reference-react-hooks-useconfirmedaction) - The recurring admin pattern (confirm, then mutate, then toast) in one hook.
