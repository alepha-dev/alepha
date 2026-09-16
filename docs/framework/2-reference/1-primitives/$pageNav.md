# $pageNav

## Import

```typescript
import { $pageNav } from "@alepha/ui/shell";
```

## Overview

`$page` sugar for shell pages: declares the page's `nav` metadata and its
permission in one place. The single `permission` value feeds both the real
route gate and the UI nav gate, eliminating the repeated permission string
that the two would otherwise both need.

Pages declared this way are picked up by `useNavTree` /
`NavShell` purely from their `nav` field, with no separate nav list.

## Options

| Option       | Type                 | Required | Description                                                                                                                                                                   |
| ------------ | -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nav`        | `NavMeta`            | No       | Nav metadata, widened to `NavMeta` so an entry can name the catalogue keys the shell resolves for its label and its group heading                                             |
| `permission` | `string \| string[]` | No       | Permission(s) required for this page, wired into BOTH the route gate (`use: [$secure({ permissions })]`) and the nav-entry gate (`nav.permission`) so the two can never drift |
