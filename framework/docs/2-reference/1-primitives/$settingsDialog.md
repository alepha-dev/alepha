# $settingsDialog

## Import

```typescript
import { $settingsDialog } from "@alepha/ui/settings";
```

## Overview

Declare a settings dialog: a large modal over the current page (full
screen on a phone) with a nav of sections, opened with
`useSettingsDialog(name).open()` and closed by itself on any route change.

It registers no route. `SettingsDialog` draws every declared dialog from
inside `DialogProvider`, so an application with one has nothing to mount.
Sections are added from any class with `$settingsSection`.

```ts
class AccountSettings {
  dialog = $settingsDialog({ name: "account", title: "Account" });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    icon: createElement(User),
    lazy: () => import("./AccountProfile.tsx"),
  });
}
```

A link made outside the dialog opens it with `?<name>=<section>`
(`/?account=sessions`): read in the browser, on load and on every client
navigation, then stripped from the URL.
