# @alepha/ui - Shell

## Installation

```bash
npm install @alepha/ui
```

## Overview

Application shells and their chrome.

`$pageNav` declares a page that appears in a shell's sidebar, for an app
that hangs its pages off its OWN layout rather than the admin shell's
(`$pageAdmin` is the same thing already parented to `AdminRouter`).

`AppShell` is the sidebar-and-header frame of an application and `NavShell`
the page-tree variant with its `Spotlight` search. `PlateLayout` and
`DetailLayout` frame a page, `AppActions` a toolbar. `ButtonDark`,
`ButtonTheme`, `ButtonLanguage`, `ButtonInbox` and `ButtonUser` are the
header buttons, and `ActionErrorToaster` turns a failed action into a toast.

## API Reference

### Primitives

- [`$pageNav`](/docs/reference-primitives-$pagenav) - `$page` sugar for shell pages: declares the page's `nav` metadata and its

### React Hooks

- [`useDetailTab`](/docs/reference-react-hooks-usedetailtab) - Binds a detail page's selected tab to `?tab=<key>`.
