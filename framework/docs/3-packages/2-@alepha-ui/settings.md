# @alepha/ui - Settings

## Installation

```bash
npm install @alepha/ui
```

## Overview

The settings kit.

`$settingsDialog` declares a settings dialog, opened over the current page
and held in state, never in the URL; `$settingsSection` adds a section to it
from any class, and `useSettingsDialog` opens and closes it.

`SettingsDialog` draws a declared dialog, and `DialogProvider` draws it for
you. `SettingsSection`, `SettingsRow`, `SettingsHeading` and
`SettingsDangerSection` build a section's content, and `settingsCardEdge`
is the one card edge they all share.

## API Reference

### Primitives

- [`$settingsDialog`](/docs/reference-primitives-$settingsdialog) - Declare a settings dialog: a large modal over the current page (full
- [`$settingsSection`](/docs/reference-primitives-$settingssection) - Add a section to a settings dialog, from any class: the dialog is named by

### React Hooks

- [`useSettingsDialog`](/docs/reference-react-hooks-usesettingsdialog) - A settings dialog's state and the way to open and close it.
