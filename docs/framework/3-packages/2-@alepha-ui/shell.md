# @alepha/ui - Shell

## Installation

```bash
npm install @alepha/ui
```

## Overview

Application shells and their chrome.

`AppShell` is the sidebar-and-header frame of an application and `NavShell`
the page-tree variant with its `Spotlight` search. `PlateLayout` and
`DetailLayout` frame a page, `AppActions` a toolbar. `ButtonDark`,
`ButtonTheme`, `ButtonLanguage`, `ButtonInbox` and `ButtonUser` are the
header buttons, and `ActionErrorToaster` turns a failed action into a toast.

## API Reference

### React Hooks

- [`useDetailTab`](/docs/reference-react-hooks-usedetailtab) - Binds a detail page's selected tab to `?tab=<key>`.
