# @alepha/ui - Account

## Installation

```bash
npm install @alepha/ui
```

## Overview

The signed-in user's own account area.

`AccountRouter` mounts profile, security, sessions, connections and API keys
under one layout, each page its own lazy chunk. The pages are exported by
name too, for an app that routes them itself.

## API Reference

### Primitives

- [`$pageAccount`](/docs/reference-primitives-$pageaccount) - `$pageNav` already parented to `AccountRouter`'s `/account` shell:
