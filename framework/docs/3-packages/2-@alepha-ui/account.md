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

The profile page ends with `AccountDisplay`, the viewer's own display
settings: the colour-blind switch, which a signed-in viewer finds here and
not in the account menu.

## API Reference

### Primitives

- [`$pageAccount`](/docs/reference-primitives-$pageaccount) - `$pageNav` already parented to `AccountRouter`'s `/account` shell:
