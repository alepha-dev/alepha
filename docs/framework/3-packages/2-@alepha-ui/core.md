# @alepha/ui - Core

Shared Base UI and Tailwind components for Alepha apps. Edited directly; bugfixes propagate via normal dep updates.

## Installation

```bash
npm install @alepha/ui
```

## Overview

The primitives every Alepha interface is built from.

Buttons, inputs, cards, dialogs, sheets, menus, tooltips, the sidebar and the
rest of the Base UI + Tailwind primitives, each file exporting its whole
family. Beside them, the small pieces every surface reaches for: `cn` for
class merging, `useToast` with its `Toaster`, `useDialog` with its
`DialogProvider`, `useIsMobile`, `TimeAgo`, `UserAvatar`, `BrandIcon`,
`FileImage`, `PaneRail` and `FilterSlot`.

Imports nothing from another `@alepha/ui` module, so
`import { Button } from "@alepha/ui"` never pulls in a form, a table or a
shell. Load the stylesheet once, at the app's entry: `@alepha/ui/styles.css`.

## API Reference

### React Hooks

- [`useDialog`](/docs/reference-react-hooks-usedialog) - Imperative dialog API. Returns an object with:
- [`useIsMobile`](/docs/reference-react-hooks-useismobile) - The shadcn version this started from seeds `undefined` and fills it in from
